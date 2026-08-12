// src/lib/game/tick/factionTick.ts
// World Sim Phase 1 — Faction state, driven by `goal`, not randomly.
// World Sim Phase 3 — `goal` itself is reassessed automatically every tick
// from the faction's resulting stats (see decideFactionGoalReassessment
// below), not just set once by a GM and left alone. The admin panel's goal
// picker still exists as a seed/override, but expect the simulation to
// steer it back toward whatever its circumstances justify. This file also
// owns the two lifecycle events that can end or begin a faction's
// independent existence: collapse (absorbed by a rival, or succeeded by a
// smaller remnant) and the founding that comes out of it.
// World Sim Phase 6 — the one exception to automatic goal reassessment: a
// faction with a player character as its leader (Faction.leaderCharacterId)
// keeps whatever goal the player set, since strategic direction is their
// call, not the tick's. Everything else about it still ticks normally.
//
// Each goal applies a small fixed delta to the 4 tracked fields (resources,
// stability, military). Capped at 10 factions per campaign, consistent with
// existing campaign scale elsewhere in the codebase.

import type { Faction, FactionGoal } from '@prisma/client'
import { TickContext, TickHandlerResult, WorldChange, clamp, findRivalId, hasActiveRival, parseFactionRelationships } from './types'
import { BeliefVector, parseBeliefVector } from './beliefTick'
import { NEUTRAL_DISPOSITION, parseDisposition } from './npcDispositionTick'

interface FactionDelta {
  resources: number
  stability: number
  military: number
}

// Deterministic — same goal always produces the same delta. This is the
// entire "based on their goal, not randomly" requirement.
const GOAL_DELTAS: Record<FactionGoal, FactionDelta> = {
  EXPAND: { resources: -3, stability: -1, military: 2 },
  DEFEND: { resources: -1, stability: 2, military: 1 },
  ENRICH: { resources: 4, stability: 1, military: -1 },
  DESTABILIZE_RIVAL: { resources: -2, stability: -1, military: 1 },
  CONSOLIDATE: { resources: 1, stability: 2, military: 0 },
}

export type Band = 'LOW' | 'MEDIUM' | 'HIGH'

// The band cutoffs, exported so systems that gate on "genuinely HIGH"
// (war declaration/joining in warTick.ts, ambition resourcing in
// ambitionTick.ts) reference the same numbers instead of hardcoding
// copies that silently drift if the banding is ever rebalanced.
export const MEDIUM_BAND_MIN = 34
export const HIGH_BAND_MIN = 67

// Exported — relationshipTick.ts shares this exact banding so "stable" means
// the same thing everywhere in the tick.
export function band(value: number): Band {
  if (value < MEDIUM_BAND_MIN) return 'LOW'
  if (value < HIGH_BAND_MIN) return 'MEDIUM'
  return 'HIGH'
}

export interface FactionTickDecision {
  resources: number
  stability: number
  military: number
}

/** Pure decision function — no DB access, safe to unit test directly. */
export function decideFactionTick(faction: {
  resources: number
  stability: number
  military: number
  goal: FactionGoal
}): FactionTickDecision {
  const delta = GOAL_DELTAS[faction.goal]
  return {
    resources: clamp(faction.resources + delta.resources, 0, 100),
    stability: clamp(faction.stability + delta.stability, 0, 100),
    military: clamp(faction.military + delta.military, 0, 100),
  }
}

// Priority order matters: a faction in crisis fixes that before anything
// else, regardless of how rich or armed it is. DESTABILIZE_RIVAL only
// becomes reachable once the faction actually has a rival on record (see
// relationshipTick.ts) — otherwise there's nothing for it to mean.
/** Pure decision function — no DB access, safe to unit test directly. */
/**
 * How long a faction sticks with a goal before circumstances are allowed to
 * talk it out of one (#79).
 *
 * Without this the tick had no memory of what a faction was *just doing*,
 * and the arithmetic produced a permanent oscillation. A faction with a
 * rival and a strong army sitting near the LOW/MEDIUM resource cutoff runs:
 * DESTABILIZE_RIVAL drains 2 resources a turn until it dips under 34,
 * ENRICH earns 4 and lifts it back over, which immediately re-qualifies
 * DESTABILIZE_RIVAL — a three-turn cycle that repeats forever. The faction
 * abandons its scheme every third turn to go make money, resumes it, and
 * never accumulates enough to actually do anything.
 *
 * Three turns is deliberately short. This is meant to stop a faction
 * flip-flopping across a band boundary, not to make it stubborn — a real
 * shift in circumstances should still redirect it, just not a one-point
 * drift back and forth over the same line.
 */
export const GOAL_COMMITMENT_TURNS = 3

// #104: how strongly a belief axis has to have drifted from NEUTRAL_BELIEF
// (50) before it's allowed to redirect goal choice on its own. Deliberately
// high — a faction has to have drifted substantially (many repeated events;
// see beliefTick.ts's DRIFT_AMOUNT=4 per event) for disposition to override
// what the stat bands alone would pick, matching "a small delta... as an
// additional weighted input" rather than a dominant override at neutral.
const BELIEF_OVERRIDE_THRESHOLD = 80

export interface FactionGoalExplanation {
  goal: FactionGoal
  /** Human-readable trace of which check fired, in evaluation order — the
   * same branches decideFactionGoalReassessment picks from, just narrated
   * instead of discarded. #94: admin tooling reads this to show a host
   * WHY a faction is about to reassess (or hold) its goal, not just that
   * it did. */
  reasoning: string[]
}

/**
 * Pure — the full goal-reassessment decision, WITH the reasoning trace.
 * decideFactionGoalReassessment below is a thin wrapper over this; the two
 * can never drift apart because there's only one implementation.
 */
export function explainFactionGoalReassessment(faction: {
  resources: number
  stability: number
  military: number
  goal: FactionGoal
  hasRival: boolean
  /**
   * Turns the faction has already held its current goal, read back from the
   * `faction.goal` world events the tick has always written (see
   * worldEventLog.ts). History as a decision input, with no new column:
   * the record of what it decided last time is what stops it thrashing.
   */
  turnsOnCurrentGoal?: number
  /** #104: parsed Faction.beliefVector, or undefined/null when unset — a
   * faction with no drift history yet is untouched by any of the override
   * branches below, identical to pre-#104 behavior. */
  beliefVector?: BeliefVector | null
}): FactionGoalExplanation {
  const stabilityBand = band(faction.stability)
  const resourcesBand = band(faction.resources)
  const militaryBand = band(faction.military)
  const reasoning: string[] = [
    `Stability is ${stabilityBand} (${faction.stability}), resources ${resourcesBand} (${faction.resources}), military ${militaryBand} (${faction.military}).`,
  ]

  // Internal cohesion is failing — shore it up before anything ambitious.
  // Checked BEFORE commitment on purpose: a faction coming apart does not
  // stay the course out of consistency, and a crisis is exactly the kind
  // of real change that should always be able to redirect it.
  if (stabilityBand === 'LOW') {
    reasoning.push('Stability has cratered — internal cohesion takes priority over any ambition.')
    return { goal: 'DEFEND', reasoning }
  }

  // Otherwise, hold the current course until it has been given a fair run.
  const held = Number(faction.turnsOnCurrentGoal)
  if (Number.isFinite(held) && held >= 0 && held < GOAL_COMMITMENT_TURNS) {
    reasoning.push(`Has held its current goal (${faction.goal}) for only ${held} turn(s), short of the ${GOAL_COMMITMENT_TURNS}-turn commitment — staying the course rather than reassessing.`)
    return { goal: faction.goal, reasoning }
  }
  // Too poor to attempt anything ambitious — rebuild the treasury first.
  if (resourcesBand === 'LOW') {
    reasoning.push('Resources are too low to attempt anything ambitious — rebuilding the treasury first.')
    return { goal: 'ENRICH', reasoning }
  }

  // #104: a strongly-held disposition can redirect a faction toward a goal
  // the raw stat bands alone wouldn't have picked — same shape as hasRival
  // overriding pure stat-band logic below, just belief-driven instead.
  // Isolationism is checked first: a faction that has drifted toward
  // withdrawal turtles even if it's otherwise strong enough to push
  // outward, and "withdraw" and "push outward" can't both win.
  const belief = faction.beliefVector
  if (belief) {
    reasoning.push(`Belief vector: aggression ${belief.aggression}, isolationism ${belief.isolationism}, mercantilism ${belief.mercantilism}, zealotry ${belief.zealotry} (override threshold ${BELIEF_OVERRIDE_THRESHOLD}).`)
    if (belief.isolationism >= BELIEF_OVERRIDE_THRESHOLD) {
      reasoning.push(`Isolationism has drifted past the override threshold — the faction turtles inward regardless of its stat bands.`)
      return { goal: 'CONSOLIDATE', reasoning }
    }
    if (belief.zealotry >= BELIEF_OVERRIDE_THRESHOLD && militaryBand !== 'LOW') {
      const goal = faction.hasRival ? 'DESTABILIZE_RIVAL' : 'EXPAND'
      reasoning.push(`Zealotry has drifted past the override threshold and military isn't LOW — fervor pushes it to ${faction.hasRival ? 'undermine its rival' : 'expand'}.`)
      return { goal, reasoning }
    }
    if (belief.mercantilism >= BELIEF_OVERRIDE_THRESHOLD && resourcesBand !== 'HIGH') {
      reasoning.push(`Mercantilism has drifted past the override threshold and resources aren't already HIGH — profit-seeking wins out.`)
      return { goal: 'ENRICH', reasoning }
    }
    if (belief.aggression >= BELIEF_OVERRIDE_THRESHOLD && militaryBand !== 'LOW') {
      const goal = faction.hasRival ? 'DESTABILIZE_RIVAL' : 'EXPAND'
      reasoning.push(`Aggression has drifted past the override threshold and military isn't LOW — hostility pushes it to ${faction.hasRival ? 'undermine its rival' : 'expand'}.`)
      return { goal, reasoning }
    }
  }

  // Strong enough to act, and there's a known rival to act against —
  // prioritized over blind expansion, since undermining a specific
  // competitor is more strategically pointed than generic growth.
  if (faction.hasRival && militaryBand === 'HIGH') {
    reasoning.push('Military is HIGH and a known rival exists — undermining a specific competitor beats blind expansion.')
    return { goal: 'DESTABILIZE_RIVAL', reasoning }
  }
  // Strong on every front that matters for pushing outward — safe to expand.
  if (militaryBand === 'HIGH' && resourcesBand === 'HIGH') {
    reasoning.push('Military and resources are both HIGH — strong enough on every front to push outward.')
    return { goal: 'EXPAND', reasoning }
  }
  // Otherwise, hold what it has.
  reasoning.push('No threshold or override fired strongly enough to redirect it — holding what it has.')
  return { goal: 'CONSOLIDATE', reasoning }
}

export function decideFactionGoalReassessment(faction: Parameters<typeof explainFactionGoalReassessment>[0]): FactionGoal {
  return explainFactionGoalReassessment(faction).goal
}

const COLLAPSE_STABILITY_THRESHOLD = 10
const ABSORPTION_TRANSFER_RATE = 0.3
// #112: a smooth handoff and a chaotic collapse used to transfer faction
// state identically. Even a total-chaos collapse (roughness 1) still
// transfers at least this fraction of the base rate — a rougher collapse
// scatters more of what's left, but never scatters everything.
const ROUGHNESS_RATE_FLOOR = 0.5

export interface FactionCollapseDecision {
  collapses: boolean
  transferResources: number
  transferMilitary: number
  /** 0-1. How chaotic this specific collapse was — how far stability
   * crashed past COLLAPSE_STABILITY_THRESHOLD rather than just barely
   * tipping over it. Scales both this decision's own transfer rate and
   * decideFactionFounding's inheritance rate below, so a faction that
   * cratered to 0 stability hands off less than one that collapsed right
   * at the threshold. */
  roughness: number
}

/** 0 right at the threshold (smoothest possible collapse), 1 once stability
 * has crashed all the way to 0 (total chaos). */
function computeCollapseRoughness(stability: number): number {
  const effectiveStability = Number.isFinite(Number(stability)) ? Number(stability) : COLLAPSE_STABILITY_THRESHOLD
  return clamp((COLLAPSE_STABILITY_THRESHOLD - effectiveStability) / COLLAPSE_STABILITY_THRESHOLD, 0, 1)
}

// A faction that bottoms out doesn't just sit at LOW forever — past a
// deeper crisis point it stops existing as an independent actor. If it has
// a rival on record, that rival absorbs a slice of what's left; otherwise
// it founds a successor (see decideFactionFounding below).
/** Pure decision function — no DB access, safe to unit test directly. */
export function decideFactionCollapse(faction: {
  stability: number
  resources: number
  military: number
}): FactionCollapseDecision {
  if (faction.stability > COLLAPSE_STABILITY_THRESHOLD) {
    return { collapses: false, transferResources: 0, transferMilitary: 0, roughness: 0 }
  }
  const roughness = computeCollapseRoughness(faction.stability)
  const effectiveRate = ABSORPTION_TRANSFER_RATE * (1 - roughness * (1 - ROUGHNESS_RATE_FLOOR))
  return {
    collapses: true,
    transferResources: Math.round(faction.resources * effectiveRate),
    transferMilitary: Math.round(faction.military * effectiveRate),
    roughness,
  }
}

const SUCCESSOR_INHERITANCE_RATE = 0.4
// Deliberately NOT a fraction of the collapsed faction's stability — that
// value is at or below COLLAPSE_STABILITY_THRESHOLD by definition, so
// inheriting a percentage of it would found a successor already in crisis,
// which would immediately re-collapse next tick. A successor state starts
// humbled but functional, not stillborn.
const SUCCESSOR_STARTING_STABILITY = 40

export interface FactionFoundingDecision {
  name: string
  resources: number
  stability: number
  military: number
}

// A collapsing faction with no rival to absorb it doesn't just vanish — a
// smaller successor rises from the wreckage instead, carrying forward only
// a fraction of its predecessor's wealth and military capacity.
/** Pure decision function — no DB access, safe to unit test directly. */
export function decideFactionFounding(collapsedFaction: {
  name: string
  resources: number
  military: number
  /** 0-1, from decideFactionCollapse's roughness (#112) — how chaotic the
   * collapse that spawned this successor was. Defaults to 0 (smoothest,
   * matching the original flat-rate behavior) when omitted. */
  roughness?: number
}): FactionFoundingDecision {
  const roughness = Number.isFinite(Number(collapsedFaction.roughness)) ? Number(collapsedFaction.roughness) : 0
  const effectiveRate = SUCCESSOR_INHERITANCE_RATE * (1 - roughness * (1 - ROUGHNESS_RATE_FLOOR))
  return {
    name: `${collapsedFaction.name} Remnant`,
    resources: Math.round(collapsedFaction.resources * effectiveRate),
    stability: SUCCESSOR_STARTING_STABILITY,
    military: Math.round(collapsedFaction.military * effectiveRate),
  }
}

// NPC motivation model: at or above this loyalty, a member's attachment to
// the faction they belonged to outweighs falling in with whoever absorbed
// it — they stay independent instead of defecting. Below it, they follow
// the absorber, matching the original unconditional behavior. Deliberately
// above NEUTRAL_DISPOSITION's 50, so an ordinary, undrifted member still
// defects by default — this only holds someone back once loyalty has
// genuinely drifted high.
const LOYALTY_STAY_THRESHOLD = 70

export interface DefectionCandidate {
  id: string
  /** NPC motivation model — optional, falls back to NEUTRAL_DISPOSITION.loyalty (50) when absent. */
  loyalty?: number
}

export interface DefectionDecision {
  defectingIds: string[]
  independentIds: string[]
}

/**
 * Pure decision function — no DB access, safe to unit test directly. Who,
 * among a collapsed faction's members, actually follows the rival that
 * absorbed it vs. refuses and stays independent.
 */
export function decideDefection(members: DefectionCandidate[]): DefectionDecision {
  const defectingIds: string[] = []
  const independentIds: string[] = []
  for (const member of members) {
    const loyalty = member.loyalty ?? NEUTRAL_DISPOSITION.loyalty
    if (loyalty >= LOYALTY_STAY_THRESHOLD) {
      independentIds.push(member.id)
    } else {
      defectingIds.push(member.id)
    }
  }
  return { defectingIds, independentIds }
}

export async function tickFactions(ctx: TickContext): Promise<TickHandlerResult> {
  const factions = await ctx.db.faction.findMany({
    where: { campaignId: ctx.campaignId, isActive: true },
    orderBy: { createdAt: 'asc' },
    take: ctx.factionCap,
  })

  // #79: how long each faction has held its current goal, read back from
  // the `faction.goal` events the tick has always written. No new column —
  // the world's own record of what it decided last time is what stops it
  // deciding the opposite next turn.
  //
  // A faction with no goal-change event on record has held its goal since
  // the campaign began, which is well past the commitment window, so an
  // absent entry correctly means "free to reconsider".
  //
  // Fail-soft: goal commitment is a refinement, not a correctness
  // requirement, and the faction tick ran without it for the whole life of
  // the project. Losing the read should cost the anti-thrash behaviour for
  // one turn, not the entire faction simulation.
  const turnsOnGoalByFaction = new Map<string, number>()
  try {
    const goalChangeEvents = await ctx.db.worldEvent.findMany({
      where: { campaignId: ctx.campaignId, type: 'faction.goal' },
      select: { targetId: true, turnNumber: true },
      orderBy: { turnNumber: 'desc' },
    })
    for (const event of goalChangeEvents ?? []) {
      // Ordered newest-first, so the first entry per faction is its latest
      // goal change and the rest are history.
      if (turnsOnGoalByFaction.has(event.targetId)) continue
      turnsOnGoalByFaction.set(event.targetId, ctx.turnNumber - event.turnNumber)
    }
  } catch (error) {
    console.error('Could not read goal history; goals reassess without commitment this turn:', error)
  }

  // Uncapped set of every currently-active faction, used to ignore
  // relationship entries pointing at collapsed factions. relationshipTick
  // (which runs first) expires those entries each turn, but a faction that
  // collapses THIS turn, inside this very loop, leaves its rivals' entries
  // stale until next turn — so this check covers the same-tick window, and
  // the set is kept current as collapses happen below.
  const activeFactionIds = new Set(
    (
      await ctx.db.faction.findMany({
        where: { campaignId: ctx.campaignId, isActive: true },
        select: { id: true },
      })
    ).map((f) => f.id)
  )

  const changes: WorldChange[] = []

  // #199: `factions` above is a single snapshot taken before this loop
  // starts — but an earlier faction's collapse this same tick can write a
  // real absorption transfer into a LATER faction's row (the `absorber`
  // branch below). Without this, that later faction's own regular-tick
  // write — still computed from its stale pre-loop snapshot — silently
  // overwrote the transfer the instant its own turn came up, discarding it
  // with no error. Tracking the cumulative resources/military delta already
  // applied to each faction id this tick lets every faction's own turn
  // start from its real current state, however far into the loop it runs,
  // regardless of `dryRun` (so a preview stays accurate too).
  const appliedDeltaThisTick = new Map<string, { resources: number; military: number }>()

  for (const rawFaction of factions) {
    const pendingDelta = appliedDeltaThisTick.get(rawFaction.id)
    const faction = pendingDelta
      ? {
          ...rawFaction,
          resources: clamp(rawFaction.resources + pendingDelta.resources, 0, 100),
          military: clamp(rawFaction.military + pendingDelta.military, 0, 100),
        }
      : rawFaction

    const next = decideFactionTick(faction)
    const relationships = parseFactionRelationships(faction.relationships)
    const collapse = decideFactionCollapse(next)

    if (collapse.collapses) {
      // #103: recorded before anything else so tickWake (later in this same
      // pass) can look up this collapse's real roughness instead of
      // assuming a default for a wake it didn't compute itself.
      ctx.collapseRoughnessByFactionId?.set(faction.id, collapse.roughness)

      const rivalId = findRivalId(relationships)
      const absorber = rivalId ? await ctx.db.faction.findUnique({ where: { id: rivalId } }) : null

      let successorName: string | null = null

      if (absorber?.isActive) {
        // NPC motivation model: not every member automatically defects to
        // whoever absorbed their faction — loyalty (drifted per-NPC, see
        // npcDispositionTick.ts) decides who follows and who refuses and
        // goes independent instead. This read runs regardless of dryRun
        // (it's just a read); only the writes below are gated.
        const members = await ctx.db.nPC.findMany({
          where: { factionId: faction.id },
          select: { id: true, disposition: true },
        })
        const defection = decideDefection(members.map((m) => ({ id: m.id, loyalty: parseDisposition(m.disposition)?.loyalty })))

        if (!ctx.dryRun) {
          await ctx.db.faction.update({
            where: { id: absorber.id },
            data: {
              resources: clamp(absorber.resources + collapse.transferResources, 0, 100),
              military: clamp(absorber.military + collapse.transferMilitary, 0, 100),
            },
          })

          // Members defect to whoever absorbed their faction — demoted to
          // MEMBER regardless of prior role, since the absorbing faction
          // already has its own leadership; tickFactionLeadership will fill
          // any resulting gap there if it somehow doesn't. A member whose
          // loyalty held (see decideDefection) stays independent instead.
          if (defection.defectingIds.length > 0) {
            await ctx.db.nPC.updateMany({
              where: { id: { in: defection.defectingIds } },
              data: { factionId: absorber.id, factionRole: 'MEMBER' },
            })
          }
          if (defection.independentIds.length > 0) {
            await ctx.db.nPC.updateMany({
              where: { id: { in: defection.independentIds } },
              data: { factionId: null, factionRole: null },
            })
          }

          // Territory follows the same fate as the members — the absorber
          // takes it all, and nothing stays contested against an owner that
          // no longer exists.
          await ctx.db.location.updateMany({
            where: { ownerFactionId: faction.id },
            data: { ownerFactionId: absorber.id, isContested: false },
          })
        }

        // #199: record the transfer regardless of dryRun — if absorber.id
        // hasn't had its own turn in this loop yet, this is what lets that
        // turn start from the real post-absorption state instead of
        // clobbering it (see the appliedDeltaThisTick declaration above).
        const existingDelta = appliedDeltaThisTick.get(absorber.id) ?? { resources: 0, military: 0 }
        appliedDeltaThisTick.set(absorber.id, {
          resources: existingDelta.resources + collapse.transferResources,
          military: existingDelta.military + collapse.transferMilitary,
        })
      } else {
        // No rival to absorb it — a smaller successor rises from the
        // wreckage instead of the faction simply vanishing.
        const successor = decideFactionFounding({ name: faction.name, resources: next.resources, military: next.military, roughness: collapse.roughness })
        successorName = successor.name

        if (!ctx.dryRun) {
          const createdSuccessor = await ctx.db.faction.create({
            data: {
              campaignId: ctx.campaignId,
              name: successor.name,
              resources: successor.resources,
              stability: successor.stability,
              military: successor.military,
              goal: 'CONSOLIDATE',
              archetype: faction.archetype,
              threatLevel: 1,
              isActive: true,
              // A player still leads the remnant if they led the predecessor —
              // the collapse is a setback for their leadership, not the end of it.
              leaderCharacterId: faction.leaderCharacterId,
            },
          })

          // Members carry over to the remnant with their existing roles —
          // it's the same people, just organized smaller.
          await ctx.db.nPC.updateMany({
            where: { factionId: faction.id },
            data: { factionId: createdSuccessor.id },
          })

          // The remnant inherits the predecessor's territory too — diminished
          // in strength, not in borders (borders erode later via rivals'
          // EXPAND ambitions, not by fiat at founding).
          await ctx.db.location.updateMany({
            where: { ownerFactionId: faction.id },
            data: { ownerFactionId: createdSuccessor.id, isContested: false },
          })
        }
      }

      if (!ctx.dryRun) {
        await ctx.db.faction.update({
          where: { id: faction.id },
          data: { resources: next.resources, stability: next.stability, military: next.military, isActive: false },
        })
      }

      changes.push({
        entityType: 'FACTION',
        entityId: faction.id,
        entityName: faction.name,
        campaignId: ctx.campaignId,
        field: 'collapsed',
        previousValue: 'active',
        newValue: absorber?.isActive ? 'absorbed' : 'succeeded',
        reason: absorber?.isActive
          ? `${faction.name} collapses under its own instability and is absorbed by ${absorber.name}`
          : `${faction.name} collapses under its own instability; ${successorName} rises from the wreckage`,
        significant: true,
        importance: 'MAJOR',
      })

      // Skip normal goal reassignment/stat-band logging for a faction that
      // no longer exists as an independent actor as of this tick.
      activeFactionIds.delete(faction.id)
      continue
    }

    // World Sim Phase 6: a player-led faction's goal is the player's call,
    // not the tick's — skip reassessment and leave whatever they (or the AI
    // narrating their decision through scene resolution) last set it to.
    // A rival only counts if it still exists as an active faction — see the
    // activeFactionIds comment above.
    const factionHasRival = hasActiveRival(relationships, activeFactionIds)
    const nextGoal = faction.leaderCharacterId
      ? faction.goal
      : decideFactionGoalReassessment({
          ...next,
          goal: faction.goal,
          hasRival: factionHasRival,
          turnsOnCurrentGoal: turnsOnGoalByFaction.get(faction.id),
          beliefVector: parseBeliefVector(faction.beliefVector),
        })

    if (!ctx.dryRun) {
      await ctx.db.faction.update({
        where: { id: faction.id },
        data: {
          resources: next.resources,
          stability: next.stability,
          military: next.military,
          goal: nextGoal,
        },
      })
    }

    changes.push(
      ...buildFactionChanges(ctx.campaignId, faction, next)
    )

    if (nextGoal !== faction.goal) {
      changes.push({
        entityType: 'FACTION',
        entityId: faction.id,
        entityName: faction.name,
        campaignId: ctx.campaignId,
        field: 'goal',
        previousValue: faction.goal,
        newValue: nextGoal,
        reason: `${faction.name}'s circumstances shifted its priorities from ${faction.goal} to ${nextGoal}`,
        significant: true,
        importance: 'NORMAL',
      })
    }
  }

  return { changes }
}

// A field is only "significant" (worth a history entry) when it crosses a
// LOW/MEDIUM/HIGH band boundary — small +/-1..4 nudges every tick would
// otherwise flood the log.
function buildFactionChanges(
  campaignId: string,
  faction: Faction,
  next: FactionTickDecision
): WorldChange[] {
  const changes: WorldChange[] = []
  const fields: Array<{ key: keyof FactionTickDecision; label: string; prev: number }> = [
    { key: 'resources', label: 'resources', prev: faction.resources },
    { key: 'stability', label: 'stability', prev: faction.stability },
    { key: 'military', label: 'military', prev: faction.military },
  ]

  for (const field of fields) {
    const prevBand = band(field.prev)
    const nextBand = band(next[field.key])
    if (prevBand === nextBand) continue

    changes.push({
      entityType: 'FACTION',
      entityId: faction.id,
      entityName: faction.name,
      campaignId,
      field: field.label,
      previousValue: field.prev,
      newValue: next[field.key],
      reason: `${faction.name}'s ${field.label} moved from ${prevBand} to ${nextBand} while pursuing ${faction.goal}`,
      significant: true,
      importance: nextBand === 'LOW' ? 'MAJOR' : 'NORMAL',
    })
  }

  return changes
}
