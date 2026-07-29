// src/lib/game/integrity/escalation.ts
// "Every data violation has a code-level cause." Orphan relationship keys
// were an applier skipping entity resolution; a dangling location id was a
// missing FK. So a violation that keeps coming back isn't a data problem
// being slow to settle — a correct repair is permanent, so recurrence
// itself means something is still producing bad state. This module reads
// that signal out of WorldEvent history and reports it as EVIDENCE. It
// never attempts a fix — see the plan's Phase 5 for why that boundary is
// deliberate (a green test suite already proved insufficient as a gate,
// twice, in this exact codebase).
//
// Two distinct readings of "this keeps happening", both worth telling
// apart rather than collapsing into one signal:
//   - recurring on ONE entity → a wrong worldRule (Phase 4's own
//     auto-retirement) or one specific code path fighting this row.
//   - recurring across MANY entities → a systematic bug in whatever write
//     path produces this shape, not a one-off.

import type { Prisma, PrismaClient } from '@prisma/client'
import { TickEntityType } from '../tick/types'
import {
  RECURRING_ENTITY_TURN_THRESHOLD,
  SYSTEMIC_ENTITY_COUNT_THRESHOLD,
} from './caps'
import { Escalation, Violation } from './types'

type Db = Prisma.TransactionClient | PrismaClient

/** One past integrity repair, enough to reconstruct a Violation-shaped
 * sample without a second DB round-trip. Deliberately NOT the full
 * WorldEvent row — this is exactly what escalation.ts needs and nothing
 * check-specific, so it stays decoupled from any one check's internals. */
export interface IntegrityEventRecord {
  checkKey: string
  entityType: TickEntityType
  entityId: string
  entityName: string
  turnNumber: number
  description: string
}

/**
 * Pure: given every known integrity-repair event for a campaign (history
 * loaded from WorldEvent, plus this pass's own just-applied repairs, which
 * haven't been persisted yet when this runs — see runIntegrityPass.ts),
 * decide what looks like a code bug rather than routine drift.
 */
export function detectEscalations(events: IntegrityEventRecord[]): Escalation[] {
  const byCheckKey = new Map<string, IntegrityEventRecord[]>()
  for (const event of events) {
    const group = byCheckKey.get(event.checkKey) ?? []
    group.push(event)
    byCheckKey.set(event.checkKey, group)
  }

  const escalations: Escalation[] = []

  for (const [checkKey, group] of byCheckKey) {
    const mostRecent = [...group].sort((a, b) => b.turnNumber - a.turnNumber)[0]
    const sample: Violation = {
      checkKey,
      entityType: mostRecent.entityType,
      entityId: mostRecent.entityId,
      entityName: mostRecent.entityName,
      description: mostRecent.description,
    }

    const byEntity = new Map<string, IntegrityEventRecord[]>()
    for (const event of group) {
      const forEntity = byEntity.get(event.entityId) ?? []
      forEntity.push(event)
      byEntity.set(event.entityId, forEntity)
    }

    for (const [entityId, entityEvents] of byEntity) {
      const distinctTurns = new Set(entityEvents.map((e) => e.turnNumber))
      if (distinctTurns.size >= RECURRING_ENTITY_TURN_THRESHOLD) {
        escalations.push({
          checkKey,
          kind: 'recurring-entity',
          entityIds: [entityId],
          turnNumbers: [...distinctTurns].sort((a, b) => a - b),
          occurrences: entityEvents.length,
          sample,
        })
      }
    }

    const distinctEntityIds = [...byEntity.keys()]
    if (distinctEntityIds.length >= SYSTEMIC_ENTITY_COUNT_THRESHOLD) {
      escalations.push({
        checkKey,
        kind: 'systemic',
        entityIds: distinctEntityIds,
        turnNumbers: [...new Set(group.map((e) => e.turnNumber))].sort((a, b) => a - b),
        occurrences: group.length,
        sample,
      })
    }
  }

  return escalations
}

/**
 * Load recent integrity-repair history for a campaign. Bounded rather than
 * scoped to a turn range — `checkKey IS NOT NULL` events are rare (they
 * only exist when something was actually wrong), so 500 is a generous cap
 * that still keeps this a cheap, single indexed query even on a long-lived
 * campaign.
 */
export async function loadRecentIntegrityEvents(db: Db, campaignId: string): Promise<IntegrityEventRecord[]> {
  const rows = await db.worldEvent.findMany({
    where: { campaignId, checkKey: { not: null } },
    select: { checkKey: true, targetType: true, targetId: true, targetName: true, turnNumber: true, reason: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  return rows.map((row) => ({
    checkKey: row.checkKey as string,
    entityType: row.targetType as TickEntityType,
    entityId: row.targetId,
    entityName: row.targetName,
    turnNumber: row.turnNumber,
    description: row.reason,
  }))
}
