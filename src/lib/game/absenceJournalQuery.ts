// src/lib/game/absenceJournalQuery.ts
// #445: the fog-gated read behind the absence journal, with two consumers.
//
// #396 built the journal off WorldEvent — "the record that has always covered
// every entity type, and that no player surface read" — and connected it to
// exactly one surface: the away-recap route, which renders it in the lobby.
// Nothing in src/lib/ai read it. So the AI still had no "what changed while
// you were gone" input, which was the stated point of building it.
//
// sceneIntro DID have an offscreen block, and it read TimelineEvent — the
// NARRATED feed, i.e. precisely the incomplete record #396 exists to replace.
// A clock advancing, a debt cascading, a war resolving: all in WorldEvent,
// none of them guaranteed a TimelineEvent row, so the opener could not reach
// for them.
//
// This lives in lib/game rather than inside the route so the second consumer
// is a CONSUMER and not a second copy of the fog rule. That rule is the part
// most easily got wrong (see the per-TYPE reasoning below), and this audit
// has already found several shared-invariant-with-voluntary-adoption bugs.

import { prisma } from '@/lib/prisma'
import { buildAbsenceJournal, MAX_JOURNAL_ENTRIES, type AbsenceJournal } from './absenceJournal'
import { DISCOVERY_GATED_ENTITY_TYPES } from '@/lib/notifications/world-digest'
import { visibleTo, type CampaignRole } from '@/lib/api/visibility'

/**
 * How many raw WorldEvent rows one reconstruction reads before selecting.
 *
 * #445: this is a SAMPLE bound, and the journal is now told so. The scan is
 * ordered newest-first, so a long absence's oldest events fall off the end —
 * and turnRange/totalEvents used to be computed from what survived, which
 * reported a thirty-day absence as roughly ten turns. The number shown was
 * wrong, not merely capped. The real window comes from the aggregate below,
 * which reads no rows at all.
 */
export const JOURNAL_SCAN_LIMIT = 400

/**
 * Reconstruct an absence from the durable record.
 *
 * Fog is applied per entity TYPE, not per id (#395). Only NPCs and factions
 * model discovery; a location, a clock, a quest, a war or a debt is not
 * something the party "learns exists", so testing those ids against a
 * discovered-entity set built from factions and NPCs would make every one of
 * them structurally unreachable — exactly the bug that hid weather and clocks
 * from the digest.
 *
 * The discovered set comes from visibleTo(), not a hand-written
 * `isDiscovered: true`, so a GM's own recap is not fogged from them and the
 * polarity is decided in one place (clocks gate on isHidden, inverted).
 */
export async function loadAbsenceJournal(
  campaignId: string,
  since: Date,
  role: CampaignRole
): Promise<AbsenceJournal> {
  const scanWhere = { campaignId, createdAt: { gt: since } }
  const [events, discoveredFactions, discoveredNpcs] = await Promise.all([
    prisma.worldEvent.findMany({
      where: scanWhere,
      orderBy: [{ turnNumber: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: JOURNAL_SCAN_LIMIT,
      select: {
        id: true, turnNumber: true, createdAt: true, targetType: true,
        targetId: true, targetName: true, field: true,
        significant: true, importance: true,
      },
    }),
    prisma.faction.findMany({ where: { campaignId, ...visibleTo('faction', role) }, select: { id: true } }),
    prisma.nPC.findMany({ where: { campaignId, ...visibleTo('npc', role) }, select: { id: true } }),
  ])

  const discoveredIds = new Set([...discoveredFactions, ...discoveredNpcs].map((e) => e.id))
  const gated = new Set<string>(DISCOVERY_GATED_ENTITY_TYPES)
  const visible = events.filter((e) => (gated.has(e.targetType) ? discoveredIds.has(e.targetId) : true))

  // #445: the true window, measured rather than inferred from the sample.
  //
  // Fogged the same way `visible` is, so the count a player sees matches the
  // events they would have been allowed to see — a total that included
  // undiscovered NPCs would leak their existence as a number. One aggregate
  // over an indexed range, so it stays O(1) rows read no matter how long the
  // absence.
  const window = await prisma.worldEvent.aggregate({
    where: {
      ...scanWhere,
      OR: [
        { targetType: { notIn: [...DISCOVERY_GATED_ENTITY_TYPES] } },
        { targetId: { in: [...discoveredIds] } },
      ],
    },
    _count: { _all: true },
    _min: { turnNumber: true },
    _max: { turnNumber: true },
  }).catch((err: unknown) => {
    // Degrades to the sample-derived numbers rather than failing the recap:
    // an approximate range is worse than a real one and far better than no
    // "while you were away" at all.
    console.error('Absence-window aggregate failed (non-critical):', err)
    return null
  })

  const windowTotals = window && window._count._all > 0
    ? {
        totalEvents: window._count._all,
        turnRange:
          window._min.turnNumber !== null && window._max.turnNumber !== null
            ? { from: window._min.turnNumber, to: window._max.turnNumber }
            : null,
      }
    : undefined

  return buildAbsenceJournal(visible, MAX_JOURNAL_ENTRIES, windowTotals)
}
