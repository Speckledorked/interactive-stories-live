// src/lib/game/tick/npcDispositionTick.ts
// NPC motivation model — the individual-level counterpart to Faction's
// beliefVector (#104, beliefTick.ts). A faction's outward disposition
// already drifts based on what's happened to it; individual NPCs had
// nothing equivalent — a lieutenant who watched their faction win three
// wars behaves identically to one who watched it lose everything.
//
// Closed 3-axis vector, chosen for having a real downstream consumer each:
//   - selfPreservation: migrationTick.ts's flight selection (who flees a
//     distressed location first, and who refuses to flee at all).
//   - loyalty: factionTick.ts's collapse-defection split (who follows the
//     absorbing rival vs. who stays independent).
//   - ambition: leadershipTick.ts's succession scoring (who's more likely
//     to be favored for a contested seat, beyond raw importance).
//
// Same shape as beliefTick.ts throughout: pure decide function, closed
// event-kind union, validate-on-read parse, drift from the immediately
// preceding turn's WorldEvent history only (nothing needs an "already
// processed" marker — an event is only ever eligible the one turn right
// after it happened). Never exposed to the AI prompt — same boundary
// Faction.beliefVector already draws (confirmed: neither beliefVector nor
// this file's axis names appear in scenePrompt.ts/worldSummary.ts).

import { TickContext, TickHandlerResult, WorldChange, clamp, band } from './types'
import { MAJOR_IMPORTANCE_THRESHOLD } from './npcTick'
import { rosterNpcFilter } from './capOrdering'
// #419: `import type`, not a value import.
//
// ConsequenceAction is used only as a type here, and consequenceExtraction
// transitively imports openaiFetch — so the tick's "zero AI calls across
// everything it transitively imports" claim was being upheld by TypeScript
// ERASURE rather than by anything a reader or a linter could see. Adding a
// single value usage to that import would have silently pulled an AI
// client into the tick closure.
//
// zeroAiBoundary.test.ts now enforces the property structurally; this
// import is written the way the property requires.
import type { ConsequenceAction } from '@/lib/ai/consequenceExtraction'

export interface NpcDisposition {
  selfPreservation: number
  loyalty: number
  ambition: number
}

const DISPOSITION_AXES: (keyof NpcDisposition)[] = ['selfPreservation', 'loyalty', 'ambition']

// Matches beliefTick.ts's NEUTRAL_BELIEF convention — 50 is the
// unremarkable middle of a 0-100 band, same as every other stat-band
// default in this codebase.
export const NEUTRAL_DISPOSITION: NpcDisposition = { selfPreservation: 50, loyalty: 50, ambition: 50 }

/**
 * Parse the Json column into a usable disposition, or null if
 * absent/malformed — same validate-on-read, drop-anything-malformed
 * convention as parseBeliefVector/parseCorruptionTheme/parseWorldRules.
 * Callers fall back to NEUTRAL_DISPOSITION rather than treating null as
 * zero.
 */
export function parseDisposition(raw: unknown): NpcDisposition | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  for (const axis of DISPOSITION_AXES) {
    if (typeof v[axis] !== 'number' || !Number.isFinite(v[axis])) return null
  }
  return {
    selfPreservation: clamp(v.selfPreservation as number, 0, 100),
    loyalty: clamp(v.loyalty as number, 0, 100),
    ambition: clamp(v.ambition as number, 0, 100),
  }
}

export type DispositionDriftEventKind =
  | 'ENDANGERED'
  | 'PROTECTED'
  | 'FACTION_WON'
  | 'FACTION_LOST'
  | 'FACTION_ABANDONED_THEM'
  | 'GOAL_ACHIEVED'
  | 'HEARD_FACTION_FALL'
  | 'FACTION_MOBILIZED'
  | 'AMBITION_SUCCEEDED'
  | 'AMBITION_FAILED'
  | 'TREASURY_COLLAPSED'

export interface DispositionDriftEvent {
  kind: DispositionDriftEventKind
}

// Same scale as beliefTick.ts's DRIFT_AMOUNT — a small, bounded per-event
// nudge, not a swing large enough to flip a disposition from one event.
const DRIFT_AMOUNT = 4
// Hearsay moves at half the direct rate — hearing that some faction fell
// sows doubt, but it doesn't hit like watching your own faction bleed.
// Deliberately a 1:2 ratio against DRIFT_AMOUNT, not an independent number.
const HEARSAY_DRIFT_AMOUNT = 2

/**
 * Pure — no DB access. Folds a batch of this NPC's own recent events
 * (both what happened directly to them, and what happened to their
 * faction) into their current disposition, one small nudge per event,
 * each axis independently clamped to 0-100.
 */
export function decideDispositionDrift(current: NpcDisposition, recentEvents: DispositionDriftEvent[]): NpcDisposition {
  let next = { ...current }
  for (const event of recentEvents) {
    switch (event.kind) {
      // Being personally threatened/harmed heightens self-preservation
      // instinct — it doesn't erode loyalty on its own, since the threat
      // usually comes from outside the NPC's own faction.
      case 'ENDANGERED':
        next = { ...next, selfPreservation: clamp(next.selfPreservation + DRIFT_AMOUNT, 0, 100) }
        break
      // Being spared/favored/rescued breeds gratitude toward whoever
      // protected them, and a little less need for constant vigilance.
      case 'PROTECTED':
        next = {
          ...next,
          selfPreservation: clamp(next.selfPreservation - DRIFT_AMOUNT, 0, 100),
          loyalty: clamp(next.loyalty + DRIFT_AMOUNT, 0, 100),
        }
        break
      // Watching your faction win breeds both pride (loyalty) and
      // confidence to want more (ambition).
      case 'FACTION_WON':
        next = {
          ...next,
          loyalty: clamp(next.loyalty + DRIFT_AMOUNT, 0, 100),
          ambition: clamp(next.ambition + DRIFT_AMOUNT, 0, 100),
        }
        break
      // Watching your faction lose erodes faith in it and heightens the
      // instinct to look out for yourself.
      case 'FACTION_LOST':
        next = {
          ...next,
          loyalty: clamp(next.loyalty - DRIFT_AMOUNT, 0, 100),
          selfPreservation: clamp(next.selfPreservation + DRIFT_AMOUNT, 0, 100),
        }
        break
      // A faction visibly struggling in the wake of its own institutional
      // memory loss (#103) reads as abandonment to the members left behind.
      case 'FACTION_ABANDONED_THEM':
        next = { ...next, loyalty: clamp(next.loyalty - DRIFT_AMOUNT, 0, 100) }
        break
      // A personally achieved goal reinforces the drive that pursued it.
      case 'GOAL_ACHIEVED':
        next = { ...next, ambition: clamp(next.ambition + DRIFT_AMOUNT, 0, 100) }
        break
      // Hearing (TOLD, not witnessed) that a faction collapsed sows doubt
      // about institutions in general — a smaller loyalty hit than watching
      // your own faction lose. Applies to collapses of ANY faction; the
      // rumor doesn't check affiliation before it spreads.
      case 'HEARD_FACTION_FALL':
        next = { ...next, loyalty: clamp(next.loyalty - HEARSAY_DRIFT_AMOUNT, 0, 100) }
        break
      // Your faction going to war sharpens the survival instinct — the
      // mobilization every warDeclared/warJoined event marks. Not a
      // loyalty change: people can be both loyal and suddenly very aware
      // they might die.
      case 'FACTION_MOBILIZED':
        next = { ...next, selfPreservation: clamp(next.selfPreservation + DRIFT_AMOUNT, 0, 100) }
        break
      // Your faction's grand project paying off breeds pride in it;
      // watching it fail erodes faith in the leadership that gambled.
      case 'AMBITION_SUCCEEDED':
        next = { ...next, loyalty: clamp(next.loyalty + DRIFT_AMOUNT, 0, 100) }
        break
      case 'AMBITION_FAILED':
        next = { ...next, loyalty: clamp(next.loyalty - DRIFT_AMOUNT, 0, 100) }
        break
      // The treasury visibly running dry reads as mismanagement to the
      // members left holding the bag — a loyalty hit, but only on the
      // band transition INTO low, not on every wobble of the balance.
      case 'TREASURY_COLLAPSED':
        next = { ...next, loyalty: clamp(next.loyalty - DRIFT_AMOUNT, 0, 100) }
        break
    }
  }
  return next
}

function dispositionsEqual(a: NpcDisposition, b: NpcDisposition): boolean {
  return DISPOSITION_AXES.every((axis) => a[axis] === b[axis])
}

// Consequences (src/lib/ai/consequenceExtraction.ts) that put the NPC at
// risk or did them real harm, vs. ones that helped/favored them. SPARED —
// surviving an encounter that could have gone the other way — counts as
// protecting, not endangering.
const ENDANGERING_ACTIONS: ReadonlySet<ConsequenceAction> = new Set(['KILLED', 'BETRAYED', 'ROBBED', 'HUMILIATED', 'THREATENED', 'SABOTAGED'])
const PROTECTING_ACTIONS: ReadonlySet<ConsequenceAction> = new Set(['SPARED', 'FAVORED', 'RECRUITED', 'RESCUED'])

/** This NPC's own WorldEvent rows (consequence/goalCompleted), classified — or null if not one of ours. */
function classifyOwnEvent(row: { type: string; newValue: string | null }): DispositionDriftEvent | null {
  if (row.type === 'npc.consequence') {
    const action = row.newValue as ConsequenceAction | null
    if (action && ENDANGERING_ACTIONS.has(action)) return { kind: 'ENDANGERED' }
    if (action && PROTECTING_ACTIONS.has(action)) return { kind: 'PROTECTED' }
    return null
  }
  if (row.type === 'npc.goalCompleted') {
    return { kind: 'GOAL_ACHIEVED' }
  }
  return null
}

/** This NPC's affiliated faction's WorldEvent rows, classified — same shape as beliefTick.ts's classifyWorldEvent. */
function classifyFactionEvent(row: {
  type: string
  newValue: string | null
  previousValue?: string | null
  origin: string
  wakeSourceType: string | null
}): DispositionDriftEvent | null {
  if (row.type === 'faction.warResolved') {
    if (row.newValue === 'attacker') return { kind: 'FACTION_WON' }
    if (row.newValue === 'defender') return { kind: 'FACTION_LOST' }
    return null // stalemate — no clean win/loss signal
  }
  if (row.type === 'faction.warEnded') {
    // Only ever logged for the surviving side (see warTick.ts).
    return { kind: 'FACTION_WON' }
  }
  // A declaration or a coalition joining is a mobilization whether or not
  // this faction fired the first shot — the warJoined row is logged
  // against the joiner, the warDeclared row against the attacker.
  if (row.type === 'faction.warDeclared' || row.type === 'faction.warJoined') {
    return { kind: 'FACTION_MOBILIZED' }
  }
  // The faction's grand project resolving moves loyalty with the outcome
  // — success breeds pride, failure erodes faith in the leadership.
  if (row.type === 'faction.ambitionResolved') {
    return row.newValue === 'succeeded' ? { kind: 'AMBITION_SUCCEEDED' } : { kind: 'AMBITION_FAILED' }
  }
  // Only the band transition INTO low counts: a treasury that was already
  // low staying low is old news, and every routine fluctuation isn't.
  if (row.type === 'faction.resources') {
    const prev = Number(row.previousValue)
    const next = Number(row.newValue)
    if (Number.isFinite(prev) && Number.isFinite(next) && band(prev) !== 'LOW' && band(next) === 'LOW') {
      return { kind: 'TREASURY_COLLAPSED' }
    }
    return null
  }
  // #310: origin: 'wake' alone doesn't distinguish genuine institutional-
  // memory loss (a member's death, or the faction's own collapse) from an
  // ally merely defaulting on a bailout loan (economyTick.ts's
  // FACTION_DEFAULT cascade) — all three write the identical shape
  // otherwise. Only the first two read as abandonment; a solvent faction
  // whose ally stiffed it isn't the same story beat.
  if (row.type === 'faction.stability' && row.origin === 'wake' && (row.wakeSourceType === 'NPC' || row.wakeSourceType === 'FACTION')) {
    return { kind: 'FACTION_ABANDONED_THEM' }
  }
  return null
}

/** See MAX_BELIEF_CATCHUP_TURNS — same bound, same reasoning. */
export const MAX_DISPOSITION_CATCHUP_TURNS = 30

const RELEVANT_OWN_EVENT_TYPES = ['npc.consequence', 'npc.goalCompleted']
const RELEVANT_FACTION_EVENT_TYPES = [
  'faction.warResolved',
  'faction.warEnded',
  'faction.warDeclared',
  'faction.warJoined',
  'faction.ambitionResolved',
  'faction.resources',
  'faction.stability',
]

export async function tickNpcDisposition(ctx: TickContext): Promise<TickHandlerResult> {
  // #276: idle-cron ticking can invoke this handler with the SAME
  // turnNumber over and over (WorldMeta.currentTurnNumber only advances
  // via scene resolution — nothing else ever moves it, despite this
  // file's own window looking like it should). Short-circuit once this
  // campaign's watermark already covers the turn this pass would query,
  // so the exact same WorldEvent rows never get reclassified into fresh
  // drift a second time. See the watermark fields' own doc comment on
  // WorldMeta for the full picture.
  // #375: the watermark is PER NPC, not per campaign — the exact
  // counterpart of beliefTick's fix, for the same reason. A campaign-level
  // watermark advanced past turn T after processing only the NPCs that won
  // that tick's rotation, so everyone else lost that turn's drift
  // permanently. See Faction.beliefDriftThroughTurn.
  const targetTurn = ctx.turnNumber - 1

  const npcs = await ctx.db.nPC.findMany({
    where: {
      campaignId: ctx.campaignId,
      isAlive: true,
      importance: { gte: MAJOR_IMPORTANCE_THRESHOLD },
      ...rosterNpcFilter(ctx),
      OR: [
        { dispositionDriftThroughTurn: null },
        { dispositionDriftThroughTurn: { lt: targetTurn } },
      ],
    },
    // Importance desc is the intentional priority; id breaks ties
    // deterministically. Rotation itself is resolved once per tick — see
    // capOrdering.ts.
    orderBy: [{ importance: 'desc' }, { id: 'asc' }],
    select: { id: true, name: true, factionId: true, disposition: true, dispositionDriftThroughTurn: true },
  })
  if (npcs.length === 0) return { changes: [] }

  const changes: WorldChange[] = []

  // Everything since each NPC last drifted, bounded — so an NPC that lost
  // two rotations catches up on those turns rather than skipping them, and
  // one returning after a long absence can't scan its whole history inside
  // the shared tick transaction.
  const fromTurnFor = (npc: { dispositionDriftThroughTurn: number | null }) =>
    Math.max(
      (npc.dispositionDriftThroughTurn ?? -1) + 1,
      targetTurn - MAX_DISPOSITION_CATCHUP_TURNS
    )

  // #445: TWO queries for the whole roster, not two per NPC.
  //
  // This loop issued a pair of worldEvent.findMany per NPC — up to npcCap of
  // each (20 by default, MAX_NPC_CAP of 500) inside the shared 20s tick
  // transaction, every world turn. The per-NPC watermarks differ, so these
  // take the WIDEST window and each NPC's own lower bound is applied in
  // memory below; the window is bounded by MAX_DISPOSITION_CATCHUP_TURNS
  // either way, so the same rows are read in two round trips instead of
  // forty.
  const widestFrom = Math.min(...npcs.map(fromTurnFor))
  const rosterWindow = { gte: widestFrom, lte: targetTurn }
  const factionIds = [...new Set(npcs.map((n) => n.factionId).filter((id): id is string => !!id))]

  const [allOwnEvents, allFactionEvents, allHearsayFalls] = await Promise.all([
    ctx.db.worldEvent.findMany({
      where: {
        campaignId: ctx.campaignId,
        turnNumber: rosterWindow,
        targetType: 'NPC',
        targetId: { in: npcs.map((n) => n.id) },
        type: { in: RELEVANT_OWN_EVENT_TYPES },
      },
      select: { targetId: true, turnNumber: true, type: true, newValue: true },
    }),
    // Skipped entirely when no NPC in the roster has a faction — the old
    // per-NPC form had the same short-circuit, one NPC at a time.
    factionIds.length > 0
      ? ctx.db.worldEvent.findMany({
          where: {
            campaignId: ctx.campaignId,
            turnNumber: rosterWindow,
            targetType: 'FACTION',
            targetId: { in: factionIds },
            type: { in: RELEVANT_FACTION_EVENT_TYPES },
          },
          // previousValue is selected (not just newValue) so the treasury
          // collapse classifier can react to band transitions INTO low
          // rather than every resource fluctuation.
          select: { targetId: true, turnNumber: true, type: true, newValue: true, previousValue: true, origin: true, wakeSourceType: true },
        })
      : Promise.resolve([] as Array<{ targetId: string; turnNumber: number; type: string; newValue: string | null; previousValue: string | null; origin: string; wakeSourceType: string | null }>),
    // Rumors re-enter the sim: TOLD rows (see EventWitness) about faction
    // collapses, batched the same way as the two queries above — one read
    // for the whole roster, per-NPC windows applied in memory below. Only
    // living NPCs are in this roster, so stale TOLD rows naming dead NPCs
    // can never match. The collapse WorldEvent type is
    // 'faction.collapsed' (factionTick's collapse path); a TOLD row about
    // any faction's fall counts — the rumor doesn't check affiliation.
    ctx.db.eventWitness.findMany({
      where: {
        campaignId: ctx.campaignId,
        grade: 'TOLD',
        npcId: { in: npcs.map((n) => n.id) },
        turnNumber: rosterWindow,
        worldEvent: { type: 'faction.collapsed' },
      },
      select: { npcId: true, turnNumber: true },
    }),
  ])

  function groupByTarget<T extends { targetId: string }>(rows: T[]): Map<string, T[]> {
    const byTarget = new Map<string, T[]>()
    for (const row of rows) {
      const bucket = byTarget.get(row.targetId)
      if (bucket) bucket.push(row)
      else byTarget.set(row.targetId, [row])
    }
    return byTarget
  }
  const ownByNpc = groupByTarget(allOwnEvents)
  const factionByFaction = groupByTarget(allFactionEvents)
  const hearsayByNpc = new Map<string, Array<{ turnNumber: number }>>()
  for (const row of allHearsayFalls) {
    if (!row.npcId) continue
    const bucket = hearsayByNpc.get(row.npcId)
    if (bucket) bucket.push(row)
    else hearsayByNpc.set(row.npcId, [row])
  }

  for (const npc of npcs) {
    const fromTurn = fromTurnFor(npc)
    // Each NPC's own window, applied here rather than in SQL — the grouped
    // queries above deliberately over-fetch to the widest one.
    const inWindow = <T extends { turnNumber: number }>(rows: T[]) =>
      rows.filter((row) => row.turnNumber >= fromTurn)

    const ownEvents = inWindow(ownByNpc.get(npc.id) ?? [])
    const factionEvents = npc.factionId ? inWindow(factionByFaction.get(npc.factionId) ?? []) : []

    const driftEvents = [
      ...ownEvents.map((row) => classifyOwnEvent({ type: row.type, newValue: row.newValue })),
      ...factionEvents.map((row) => classifyFactionEvent({ type: row.type, newValue: row.newValue, previousValue: row.previousValue, origin: row.origin, wakeSourceType: row.wakeSourceType })),
      // Each TOLD-about-a-collapse row in this NPC's window is one heard
      // rumor; the watermark advancing each tick means a rumor is
      // processed exactly once, like every other event here.
      ...inWindow(hearsayByNpc.get(npc.id) ?? []).map((): DispositionDriftEvent => ({ kind: 'HEARD_FACTION_FALL' })),
    ].filter((e): e is DispositionDriftEvent => e !== null)

    const current = parseDisposition(npc.disposition) ?? NEUTRAL_DISPOSITION
    const next = driftEvents.length > 0 ? decideDispositionDrift(current, driftEvents) : current
    const drifted = driftEvents.length > 0 && !dispositionsEqual(current, next)

    // One write per NPC. The watermark advances whether or not anything
    // drifted — an empty window is a real answer to "did anything happen
    // in these turns" — and the drifted disposition rides along when there
    // is one.
    if (!ctx.dryRun) {
      await ctx.db.nPC.update({
        where: { id: npc.id },
        data: {
          dispositionDriftThroughTurn: targetTurn,
          ...(drifted ? { disposition: next as object } : {}),
        },
      })
    }

    if (!drifted) continue

    changes.push({
      entityType: 'NPC',
      entityId: npc.id,
      entityName: npc.name,
      campaignId: ctx.campaignId,
      field: 'disposition',
      previousValue: JSON.stringify(current),
      newValue: JSON.stringify(next),
      reason: `${npc.name}'s outlook shifts in response to recent events`,
      // Background disposition drift, same significance tier as
      // beliefTick.ts's own faction-level equivalent — not on its own
      // worth a history/RAG entry.
      significant: false,
      importance: 'NORMAL',
    })
  }

  return { changes }
}
