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

import { TickContext, TickHandlerResult, WorldChange, clamp } from './types'
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

export interface DispositionDriftEvent {
  kind: DispositionDriftEventKind
}

// Same scale as beliefTick.ts's DRIFT_AMOUNT — a small, bounded per-event
// nudge, not a swing large enough to flip a disposition from one event.
const DRIFT_AMOUNT = 4

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
function classifyFactionEvent(row: { type: string; newValue: string | null; origin: string; wakeSourceType: string | null }): DispositionDriftEvent | null {
  if (row.type === 'faction.warResolved') {
    if (row.newValue === 'attacker') return { kind: 'FACTION_WON' }
    if (row.newValue === 'defender') return { kind: 'FACTION_LOST' }
    return null // stalemate — no clean win/loss signal
  }
  if (row.type === 'faction.warEnded') {
    // Only ever logged for the surviving side (see warTick.ts).
    return { kind: 'FACTION_WON' }
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
const RELEVANT_FACTION_EVENT_TYPES = ['faction.warResolved', 'faction.warEnded', 'faction.stability']

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

  for (const npc of npcs) {
    // Everything since this NPC last drifted, bounded — so an NPC that
    // lost two rotations catches up on those turns rather than skipping
    // them, and one returning after a long absence can't scan its whole
    // history inside the shared tick transaction.
    const turnWindow = {
      gte: Math.max(
        (npc.dispositionDriftThroughTurn ?? -1) + 1,
        targetTurn - MAX_DISPOSITION_CATCHUP_TURNS
      ),
      lte: targetTurn,
    }
    const [ownEvents, factionEvents] = await Promise.all([
      ctx.db.worldEvent.findMany({
        where: {
          campaignId: ctx.campaignId,
          turnNumber: turnWindow,
          targetType: 'NPC',
          targetId: npc.id,
          type: { in: RELEVANT_OWN_EVENT_TYPES },
        },
        select: { type: true, newValue: true },
      }),
      npc.factionId
        ? ctx.db.worldEvent.findMany({
            where: {
              campaignId: ctx.campaignId,
              turnNumber: turnWindow,
              targetType: 'FACTION',
              targetId: npc.factionId,
              type: { in: RELEVANT_FACTION_EVENT_TYPES },
            },
            select: { type: true, newValue: true, origin: true, wakeSourceType: true },
          })
        : Promise.resolve([] as { type: string; newValue: string | null; origin: string; wakeSourceType: string | null }[]),
    ])


    const driftEvents = [
      ...ownEvents.map((row) => classifyOwnEvent({ type: row.type, newValue: row.newValue })),
      ...factionEvents.map((row) => classifyFactionEvent({ type: row.type, newValue: row.newValue, origin: row.origin, wakeSourceType: row.wakeSourceType })),
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
