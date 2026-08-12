// src/lib/game/integrity/runIntegrityPass.ts
// The orchestrator: load the snapshot once, run every registered check,
// apply what has a repair (respecting the blast-radius caps), and report
// what happened. This is the ONE place that decides "is this actually
// applied" — checks and repair functions stay pure and never touch the DB
// themselves (see types.ts's doc comments for why that split matters).

import type { Prisma, PrismaClient } from '@prisma/client'
import { TickEntityType, WorldChange } from '../tick/types'
import { INTEGRITY_CHECKS, INTEGRITY_REPAIRS } from './checkRegistry'
import { loadIntegritySnapshot } from './snapshot'
import { applyRepairWrite } from './applyRepairWrite'
import { MAX_REPAIRS_PER_ENTITY, MAX_REPAIRS_PER_PASS } from './caps'
import { severityOf } from './checkSeverity'
import { detectEscalations, IntegrityEventRecord, loadRecentIntegrityEvents } from './escalation'
import { IntegrityReport, IntegritySnapshot, Violation, repairToWorldChange } from './types'

type Db = Prisma.TransactionClient | PrismaClient

export interface IntegrityPassResult {
  changes: WorldChange[]
  report: IntegrityReport
}

/**
 * Run every registered check against a campaign and apply what can be
 * auto-repaired, up to the blast-radius caps. `dryRun` mirrors the rest of
 * the tick's preview mode (TickContext.dryRun): every check still runs and
 * every repair is still decided and reported, only the actual write is
 * skipped — so the admin tick preview shows pending repairs with no
 * separate code path.
 */
export async function runIntegrityPass(
  db: Db,
  campaignId: string,
  turnNumber: number,
  options: { dryRun?: boolean } = {}
): Promise<IntegrityPassResult> {
  const dryRun = options.dryRun ?? false
  const snapshot = await loadIntegritySnapshot(db, campaignId, turnNumber)

  const { violations, perCheckMs } = runChecks(snapshot)
  const { changes, unrepaired, repairsApplied } = await applyRepairs(db, snapshot, violations, dryRun)

  // Recurrence is inherently a fixed-then-broke-again signal, so it's built
  // from what actually got REPAIRED, not every violation — an unrepaired,
  // detect-only violation (duplicate names) recurring means nothing more
  // than "we haven't built a fix for this yet", which is already known.
  // History predates this pass's own writes (persistWorldEvents runs after
  // every TICK_HANDLERS entry finishes, not per-handler), so this pass's
  // own just-applied repairs have to be added in-memory rather than
  // re-queried.
  const history = await loadRecentIntegrityEvents(db, campaignId)
  const thisPass = changesToEventRecords(changes, turnNumber)
  const escalations = detectEscalations([...history, ...thisPass])

  if (escalations.length > 0) {
    console.error(
      `🚨 Integrity escalation for ${campaignId}: ${escalations.length} pattern(s) look like a code bug, not routine drift:\n` +
      escalations.map(describeEscalation).join('\n')
    )
  }

  const report: IntegrityReport = {
    campaignId,
    turnNumber,
    timestamp: new Date().toISOString(),
    violationsFound: violations.length,
    repairsApplied,
    unrepaired,
    escalations,
    perCheckMs,
  }

  return { changes, report }
}

function changesToEventRecords(changes: WorldChange[], turnNumber: number): IntegrityEventRecord[] {
  return changes
    .filter((c) => c.origin === 'integrity' && c.checkKey)
    .map((c) => ({
      checkKey: c.checkKey as string,
      entityType: c.entityType as TickEntityType,
      entityId: c.entityId,
      entityName: c.entityName,
      turnNumber,
      description: c.reason,
    }))
}

function describeEscalation(escalation: ReturnType<typeof detectEscalations>[number]): string {
  return escalation.kind === 'recurring-entity'
    ? `  - "${escalation.checkKey}" keeps recurring on ${escalation.sample.entityName} (${escalation.entityIds[0]}) across turns ${escalation.turnNumbers.join(', ')} — a correct repair should be permanent, so something keeps re-breaking this row`
    : `  - "${escalation.checkKey}" has fired on ${escalation.entityIds.length} different entities — likely a systematic bug in whatever write path produces this shape, not isolated bad luck`
}

function runChecks(snapshot: IntegritySnapshot): { violations: Violation[]; perCheckMs: Record<string, number> } {
  const violations: Violation[] = []
  const perCheckMs: Record<string, number> = {}
  for (const check of INTEGRITY_CHECKS) {
    const start = Date.now()
    violations.push(...check.run(snapshot))
    perCheckMs[check.key] = Date.now() - start
  }
  return { violations, perCheckMs }
}

async function applyRepairs(
  db: Db,
  snapshot: IntegritySnapshot,
  violations: Violation[],
  dryRun: boolean
): Promise<{ changes: WorldChange[]; unrepaired: Violation[]; repairsApplied: number }> {
  const changes: WorldChange[] = []
  const unrepaired: Violation[] = []
  const repairCountByEntity = new Map<string, number>()
  let repairsApplied = 0

  // #225: repair order used to be pure INTEGRITY_CHECKS registration
  // order (an implementation detail of checkRegistry.ts), so a pass with
  // more repairable violations than MAX_REPAIRS_PER_PASS allowed rationed
  // the budget by array position rather than actual severity. A stable
  // sort here (Array#sort is guaranteed stable since ES2019) preserves
  // relative order within a severity tier while giving the more severe
  // tier first crack at the cap.
  const bySeverity = [...violations].sort((a, b) => severityOf(a.checkKey) - severityOf(b.checkKey))

  for (const violation of bySeverity) {
    const repairFn = INTEGRITY_REPAIRS[violation.checkKey]
    if (!repairFn) {
      // No entry means detect-only by design (duplicate names, a clock tied
      // to a collapsed faction) — reported the same as a repair fn
      // declining, never silently dropped.
      unrepaired.push(violation)
      continue
    }

    if (repairsApplied >= MAX_REPAIRS_PER_PASS) {
      unrepaired.push(violation)
      continue
    }
    const entityKey = `${violation.entityType}:${violation.entityId}`
    const entityRepairCount = repairCountByEntity.get(entityKey) ?? 0
    if (entityRepairCount >= MAX_REPAIRS_PER_ENTITY) {
      unrepaired.push(violation)
      continue
    }

    const repair = repairFn(violation, snapshot)
    if (!repair) {
      unrepaired.push(violation)
      continue
    }

    if (!dryRun) {
      await applyRepairWrite(db, repair.write)
    }
    changes.push(repairToWorldChange(repair, snapshot.campaignId))
    repairsApplied++
    repairCountByEntity.set(entityKey, entityRepairCount + 1)
  }

  return { changes, unrepaired, repairsApplied }
}
