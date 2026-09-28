// src/lib/game/tick/warTick.ts
// World Sim Phase 5 — sustained multi-turn conflict, with coalitions.
//
// Everything built through Phase 4 (ambitions, collapse, territory) is a
// one-shot event: a Clock resolves once and it's over. A war is different
// on purpose — it persists across many turns, accumulates momentum from
// both sides' relative strength, and both sides bleed resources/military
// the whole time it drags on, regardless of who's winning. It's the
// escalation of an existing contest, not a standalone trigger: a location
// has to already be contested (via a prior EXPAND or DESTABILIZE_RIVAL —
// see territory.ts) before a war over it can ignite.
//
// Coalitions: a war always DECLARES as strictly 1v1. From there, each tick,
// a side's existing ALLY factions (Faction.relationships) can be pulled in
// as additional WarParticipant rows if they're strong enough and not
// already committed to any other war — reusing the ALLY relationship type
// Phase 3 already computes but never gave any mechanical weight to before
// now. Momentum/attrition operate on the whole side (sum of all living
// participants' military; attrition paid by every living participant), but
// the contested-territory prize still goes only to the original
// attackerFactionId — an ally fighting alongside doesn't inherit land it
// never personally claimed.
//
// Runs after tickFactions/tickFactionLeadership in the handler order (see
// worldTick.ts) so it reads this turn's post-drift military/resources, and
// before tickFactionAmbitions so a faction already committed to a war this
// turn doesn't also spawn an unrelated ambition Clock on the same tick.
//
// Reads Location.isContested as of the START of this turn — contests
// created by an ambition resolving THIS turn (in worldTurn.ts, which runs
// after the deterministic tick) won't be visible for war declaration until
// next turn. Same one-tick lag already accepted for relationships/goal
// reassessment in Phase 3, for the same reason: avoids a same-turn circular
// dependency without needing a two-pass tick. New allies pulled in this
// tick, and wars declared this tick, don't get evaluated again until next
// tick either, for the same reason.

import type { Prisma } from '@prisma/client'
import type { FactionGoal } from '@prisma/client'
import { HIGH_BAND_MIN, MEDIUM_BAND_MIN, band } from './factionTick'
import { TickContext, TickHandlerResult, WorldChange, clamp, findRivalId } from './types'
import { TIE_INCLUDE, factionTies } from '../tieGraph'
import { decideArcDelta, decideArcResolution } from '../arc'
import { rosterFactionFilter } from './capOrdering'
import { isSevereWeather } from './weatherTick'
import type { WeatherCondition } from '@prisma/client'
import type { Season } from '../calendar'
import { NEUTRAL_DISPOSITION, parseDisposition } from './npcDispositionTick'
import { hasWorkingRoute } from './logisticsTick'

// Both sides must be genuinely strong — the same HIGH cutoff the rest of
// the tick uses, referenced rather than copied so a rebalance can't drift.
const WAR_MILITARY_THRESHOLD = HIGH_BAND_MIN
const WAR_DECISIVE_MOMENTUM = 60
const WAR_MAX_DURATION = 10 // ticks before an inconclusive war is called a stalemate
const ATTRITION_RESOURCES = 3
const ATTRITION_MILITARY = 2
const MAX_JOINERS_PER_SIDE_PER_TICK = 1 // a war spreads gradually, not all at once
// Storms kill indiscriminately — both sides bleed extra soldiers when the
// contested ground is in severe weather (see isSevereWeather in
// weatherTick.ts). Symmetric by design: weather doesn't take sides.
const SEVERE_WEATHER_EXTRA_MILITARY_ATTRITION = 1
// A faction whose influence has been bled dry (LOW band) can't rally for a
// new war — nobody follows a spent power into another fight. This is the
// first tick-handler read of Faction.influence (#218 wrote it; the AI
// layer was its only reader until now).
const INFLUENCE_DECLARATION_FLOOR = MEDIUM_BAND_MIN
// Threat deters: threatLevel runs 1-5 (clamped in ambitionResolution.ts),
// and at 4-5 the defender is a known terror — conquest/smear ambitions
// that raise threat now buy real deterrence instead of stat decoration.
const THREAT_DETERRENCE_LEVEL = 4
// A crumbling defender (LOW stability) lowers the bar for the attacker:
// striking a faction that's already falling apart takes less of an army
// than meeting a solid one in the field.
const CRUMBLING_DEFENDER_ADVANTAGE = 10
// A leader whose self-preservation is this high never gambles the faction
// on a war of choice — the survival instinct that keeps an NPC alive
// (see migrationTick's FLIGHT_STAY_THRESHOLD) vetoes aggression here.
const SELF_PRESERVATION_DECLARATION_VETO = 80
// A battlefield ground to ruin punishes whoever keeps fighting there —
// scorched earth has a cost. Mirrors migrationTick's DISTRESS_THRESHOLD:
// below 25/100 a location is distressed, and fighting on distressed ground
// bleeds both armies. Symmetric, like the weather attrition above.
const RUINED_BATTLEFIELD_CONDITION = 25
const RUINED_BATTLEFIELD_EXTRA_MILITARY_ATTRITION = 1
// An attacker with no working supply route to the front bleeds extra —
// overextension is punishable. Defender-side only in effect: the defender
// fights on home ground. See hasWorkingRoute in logisticsTick.ts.
const NO_SUPPLY_EXTRA_ATTACKER_MILITARY_ATTRITION = 1
// Winter campaigns bleed both armies — frozen supply lines, exposure,
// desertion. Same scale as the other environmental attritions: winter is a
// condition of the world, not a decisive weapon.
const WINTER_EXTRA_MILITARY_ATTRITION = 1

export interface WarDeclarationDecision {
  shouldDeclare: boolean
  contestedLocationId?: string
  /**
   * Set when the pair is still war-weary. Reported rather than swallowed so
   * the tick log can say WHY two rivals with contested ground and standing
   * armies did not fight — otherwise the absence looks like a bug.
   */
  exhaustionRemaining?: number
  /**
   * Set when the prospective attacker sat the war out for lack of
   * influence. Same reporting rationale as exhaustionRemaining.
   */
  influenceHesitation?: boolean
  /**
   * Set when the prospective attacker's leader lacks the ambition to
   * start a war (below the MEDIUM band floor, mirroring the ambition
   * clock gate). Reported rather than swallowed for the same reason.
   */
  dovishLeader?: boolean
  /**
   * Set when the prospective attacker has a DEFAULTED debt — a broke
   * faction can't fund a war of conquest.
   */
  defaultedDebt?: boolean
  /**
   * Set when the defender's threat level (4-5 on the 1-5 scale) deterred
   * the attack.
   */
  threatDeterrence?: boolean
  /**
   * Set when the prospective attacker's goal isn't an offensive one —
   * only EXPAND and DESTABILIZE_RIVAL factions start wars of conquest.
   */
  goalMismatch?: boolean
  /**
   * Set when the prospective attacker's own stability is LOW — a faction
   * coming apart at home doesn't go looking for a fight abroad.
   */
  stabilityHesitation?: boolean
  /**
   * Set when the prospective attacker's leader is too self-preserving to
   * risk a war (very high self-preservation) — survival first, conquest
   * never.
   */
  selfPreservationVeto?: boolean
}

/** Pure decision function — no DB access, safe to unit test directly. */
/** A war that has already been fought and settled, as the DB records it. */
export interface ResolvedWar {
  attackerFactionId: string
  defenderFactionId: string
  resolvedTurn: number | null
  /** 'attacker' | 'defender' | 'stalemate' — who prevailed. */
  outcome: string | null
}

/**
 * How long a faction stays war-weary after a war it won or drew.
 *
 * Set against WAR_MAX_DURATION (10) rather than picked from nowhere: a
 * shorter window than a war typically runs would let a pair spend most of
 * their existence fighting, which is the symptom this fixes.
 */
export const WAR_EXHAUSTION_TURNS = 6

/**
 * How long the side that LOST waits. Longer, because that is the whole
 * point of this being history rather than a flat cooldown — the OUTCOME of
 * a past war changes a future decision, not merely the fact that one
 * happened. A faction that was beaten does not come straight back.
 */
export const WAR_DEFEAT_EXHAUSTION_TURNS = 12

/**
 * Turns of war-weariness left between two factions, 0 if they are free to
 * fight again.
 *
 * Pure. `prospectiveAttackerId` matters because the window depends on who
 * lost: the loser of the last war waits roughly twice as long as the winner.
 */
export function warExhaustionRemaining(
  priorWars: ResolvedWar[],
  prospectiveAttackerId: string,
  defenderId: string,
  currentTurn: number
): number {
  if (!Array.isArray(priorWars) || priorWars.length === 0) return 0

  const between = priorWars.filter(
    (w) =>
      typeof w?.resolvedTurn === 'number' &&
      ((w.attackerFactionId === prospectiveAttackerId && w.defenderFactionId === defenderId) ||
        (w.attackerFactionId === defenderId && w.defenderFactionId === prospectiveAttackerId))
  )
  if (between.length === 0) return 0

  const latest = between.reduce((a, b) => ((b.resolvedTurn ?? 0) > (a.resolvedTurn ?? 0) ? b : a))
  const endedTurn = latest.resolvedTurn ?? 0

  // Did the faction now contemplating an attack lose that war? A stalemate
  // has no loser, so both sides get the shorter window.
  const attackerLost =
    (latest.attackerFactionId === prospectiveAttackerId && latest.outcome === 'defender') ||
    (latest.defenderFactionId === prospectiveAttackerId && latest.outcome === 'attacker')

  const window = attackerLost ? WAR_DEFEAT_EXHAUSTION_TURNS : WAR_EXHAUSTION_TURNS
  const elapsed = currentTurn - endedTurn
  // A negative elapsed means the recorded turn is ahead of the current one
  // — corrupt data rather than a real future war. Treat it as fully spent
  // rather than blocking the pair indefinitely.
  if (!Number.isFinite(elapsed) || elapsed < 0) return 0

  return Math.max(0, window - elapsed)
}

/**
 * Whether these two go to war.
 *
 * `history` is what makes this #79 rather than a coin flip on current
 * military: the War table has always recorded `resolvedTurn` and `outcome`
 * and **nothing ever read them**. Without it, the tick after a war resolved
 * the same pair could declare another over the same location, forever —
 * a world with no memory of its own biggest events.
 *
 * Optional so a caller with no history in hand behaves exactly as before,
 * which is also what makes the parameter safe to add.
 *
 * `influence` is likewise optional for the same reason: callers that don't
 * have it pass nothing and get the pre-influence behavior. When present
 * and in the LOW band, the attacker sits the war out — a faction bled dry
 * by lost wars (influence -8 per decisive loss, see the resolution path)
 * can't rally anyone into a new fight.
 *
 * `leaderAmbition`, `isDefaulted`, and `threatLevel` follow the same
 * optional contract: a dovish leader (ambition below the MEDIUM band
 * floor) won't start a war, a DEFAULTED debtor can't fund one, and a
 * defender at threat 4-5 deters the attack outright.
 *
 * `goal`, `stability`, and `leaderSelfPreservation` extend the same
 * contract: only EXPAND/DESTABILIZE_RIVAL factions declare offensive
 * wars, a LOW-stability attacker sits the war out while a LOW-stability
 * defender lowers the attacker's military bar, and a leader with very
 * high self-preservation vetoes the declaration outright.
 */
export function decideWarDeclaration(
  attacker: {
    id: string
    military: number
    influence?: number
    leaderAmbition?: number
    isDefaulted?: boolean
    goal?: FactionGoal
    stability?: number
    leaderSelfPreservation?: number
  },
  defender: { id: string; military: number; threatLevel?: number; stability?: number },
  contestedLocations: Array<{ id: string; ownerFactionId: string | null; isContested: boolean }>,
  history?: { priorWars?: ResolvedWar[]; currentTurn?: number }
): WarDeclarationDecision {
  // A crumbling defender is an easier target — the attacker doesn't need
  // quite as much of an army to roll over a faction that's already
  // falling apart. The defender's own bar is unchanged: both sides still
  // have to be real military powers for a war to ignite.
  const attackerMilitaryBar =
    defender.stability !== undefined && band(defender.stability) === 'LOW'
      ? WAR_MILITARY_THRESHOLD - CRUMBLING_DEFENDER_ADVANTAGE
      : WAR_MILITARY_THRESHOLD
  if (attacker.military < attackerMilitaryBar || defender.military < WAR_MILITARY_THRESHOLD) {
    return { shouldDeclare: false }
  }

  if (attacker.influence !== undefined && attacker.influence < INFLUENCE_DECLARATION_FLOOR) {
    return { shouldDeclare: false, influenceHesitation: true }
  }

  if (attacker.leaderAmbition !== undefined && attacker.leaderAmbition < MEDIUM_BAND_MIN) {
    return { shouldDeclare: false, dovishLeader: true }
  }

  if (attacker.isDefaulted) {
    return { shouldDeclare: false, defaultedDebt: true }
  }

  // Wars of conquest are an attacker's game — a faction consolidating at
  // home or enriching its coffers doesn't declare them, whatever its
  // army looks like. DEFEND never attacks by definition.
  if (
    attacker.goal !== undefined &&
    attacker.goal !== 'EXPAND' &&
    attacker.goal !== 'DESTABILIZE_RIVAL'
  ) {
    return { shouldDeclare: false, goalMismatch: true }
  }

  // A faction coming apart at home doesn't go looking for a fight abroad
  // — LOW stability is a reason to turtle, not to invade.
  if (attacker.stability !== undefined && band(attacker.stability) === 'LOW') {
    return { shouldDeclare: false, stabilityHesitation: true }
  }

  // Self-preservation cuts both ways: the instinct that makes an NPC flee
  // a dying town (migrationTick) makes a leader refuse to start a war.
  // Very high only — ordinary caution doesn't veto ambition.
  if (
    attacker.leaderSelfPreservation !== undefined &&
    attacker.leaderSelfPreservation >= SELF_PRESERVATION_DECLARATION_VETO
  ) {
    return { shouldDeclare: false, selfPreservationVeto: true }
  }

  if (defender.threatLevel !== undefined && defender.threatLevel >= THREAT_DETERRENCE_LEVEL) {
    return { shouldDeclare: false, threatDeterrence: true }
  }

  const exhaustion = warExhaustionRemaining(
    history?.priorWars ?? [],
    attacker.id,
    defender.id,
    history?.currentTurn ?? 0
  )
  if (exhaustion > 0) return { shouldDeclare: false, exhaustionRemaining: exhaustion }

  const prize = contestedLocations
    .filter((l) => l.ownerFactionId === defender.id && l.isContested)
    .sort((a, b) => a.id.localeCompare(b.id))[0]

  if (!prize) return { shouldDeclare: false }
  return { shouldDeclare: true, contestedLocationId: prize.id }
}

export interface WarProgressDecision {
  momentumDelta: number
  attackerResourceDelta: number
  attackerMilitaryDelta: number
  defenderResourceDelta: number
  defenderMilitaryDelta: number
}

// Momentum tracks the tug-of-war: whichever SIDE has more total military
// this turn pulls it their way, plus a small deterministic swing (seeded by
// the war+turn pair, not Math.random()) so it isn't purely a foregone
// conclusion from turn one. Both sides pay attrition every turn regardless
// of momentum — there's no free way to sit in a war. Coalitions don't
// change this function's shape at all — the caller passes in each side's
// AGGREGATE military (sum across every living participant), not a single
// faction's, so a 3-faction coalition naturally hits harder than a lone
// combatant without this function needing to know how many factions make
// up either number.
//
// #119: the actual push math (edge * 0.2, +/-10 variance, clamped to
// +/-20) is delegated to game/arc.ts's decideArcDelta with its default
// options, which reproduce this exact shape — momentum was the pattern
// that Arc generalized, so this function is now Arc's first real
// consumer/proof rather than a second, independently-drifting copy of the
// same arithmetic. War.momentum's own storage is untouched (see Arc's
// schema comment for why); only the pure math moved.
/** Pure decision function — no DB access, safe to unit test directly. */
export function decideWarProgress(
  war: { id: string },
  attacker: { military: number },
  defender: { military: number },
  turnNumber: number,
  battleWeather?: { condition: WeatherCondition; severity: number },
  battlefieldCondition?: number,
  attackerSupplyCut?: boolean,
  season?: Season
): WarProgressDecision {
  const momentumDelta = decideArcDelta(war.id, turnNumber, { sideAStrength: attacker.military, sideBStrength: defender.military })

  // Severe weather at the contested location bleeds both armies — storms
  // don't take sides. Optional so callers without weather in hand get the
  // pre-weather behavior exactly.
  const weatherAttrition =
    battleWeather && isSevereWeather(battleWeather.condition, battleWeather.severity)
      ? SEVERE_WEATHER_EXTRA_MILITARY_ATTRITION
      : 0

  // A battlefield ground to ruin punishes whoever keeps fighting there —
  // scorched earth has a cost. Symmetric, like weather: ruin doesn't take
  // sides either. Optional, same contract as battleWeather.
  const ruinAttrition =
    battlefieldCondition !== undefined && battlefieldCondition < RUINED_BATTLEFIELD_CONDITION
      ? RUINED_BATTLEFIELD_EXTRA_MILITARY_ATTRITION
      : 0

  // No working supply route to the front: the attacker bleeds extra.
  // Attacker-side only — the defender fights on home ground. Optional,
  // same contract as the other two.
  const supplyAttrition = attackerSupplyCut ? NO_SUPPLY_EXTRA_ATTACKER_MILITARY_ATTRITION : 0

  // Winter kills indiscriminately — frozen supply lines, exposure, desertion.
  // Symmetric like weather and ruin: cold doesn't take sides. Optional,
  // same contract: callers without a season in hand get pre-winter behavior.
  const winterAttrition = season === 'winter' ? WINTER_EXTRA_MILITARY_ATTRITION : 0

  return {
    momentumDelta,
    attackerResourceDelta: -ATTRITION_RESOURCES,
    attackerMilitaryDelta: -ATTRITION_MILITARY - weatherAttrition - ruinAttrition - supplyAttrition - winterAttrition,
    defenderResourceDelta: -ATTRITION_RESOURCES,
    defenderMilitaryDelta: -ATTRITION_MILITARY - weatherAttrition - ruinAttrition - winterAttrition,
  }
}

export interface WarResolutionDecision {
  resolves: boolean
  outcome: 'attacker' | 'defender' | 'stalemate' | null
}

// #119: delegates to game/arc.ts's decideArcResolution (side A = attacker,
// side B = defender) — same >=threshold-then-timeout shape, just shared.
/** Pure decision function — no DB access, safe to unit test directly. */
export function decideWarResolution(momentumAfterProgress: number, turnsElapsed: number): WarResolutionDecision {
  const arcResolution = decideArcResolution(momentumAfterProgress, turnsElapsed, WAR_DECISIVE_MOMENTUM, WAR_MAX_DURATION)
  if (!arcResolution.resolves) return { resolves: false, outcome: null }
  const outcome = arcResolution.winner === 'A' ? 'attacker' : arcResolution.winner === 'B' ? 'defender' : 'stalemate'
  return { resolves: true, outcome }
}

export interface WarMomentumExplanation {
  currentMomentum: number
  projectedMomentum: number
  turnsElapsed: number
  /** Human-readable trace of the same inputs decideWarProgress/
   * decideWarResolution already compute, narrated instead of discarded —
   * #94: admin tooling reads this to show a host WHY a war is trending the
   * way it is, not just the raw momentum number. Additive: doesn't touch
   * decideWarProgress/decideWarResolution's own tested signatures at all. */
  reasoning: string[]
}

/**
 * Pure — projects this war's next momentum push and resolution using the
 * exact same functions resolveWarProgress calls for real, and narrates why.
 */
export function explainWarMomentum(
  war: { id: string; momentum: number; startedTurn: number },
  attackerName: string,
  attackerMilitaryTotal: number,
  defenderName: string,
  defenderMilitaryTotal: number,
  turnNumber: number
): WarMomentumExplanation {
  const progress = decideWarProgress(war, { military: attackerMilitaryTotal }, { military: defenderMilitaryTotal }, turnNumber)
  const projectedMomentum = clamp(war.momentum + progress.momentumDelta, -100, 100)
  const turnsElapsed = turnNumber - war.startedTurn
  const resolution = decideWarResolution(projectedMomentum, turnsElapsed)

  const reasoning: string[] = []
  const edgeHolder =
    attackerMilitaryTotal > defenderMilitaryTotal ? attackerName : defenderMilitaryTotal > attackerMilitaryTotal ? defenderName : null
  reasoning.push(
    edgeHolder
      ? `${attackerName} (military ${attackerMilitaryTotal}) vs ${defenderName} (military ${defenderMilitaryTotal}) — the edge favors ${edgeHolder}.`
      : `${attackerName} and ${defenderName} are evenly matched on military (${attackerMilitaryTotal} each) — this turn's push comes down to variance alone.`
  )
  reasoning.push(
    `Momentum would shift by ${progress.momentumDelta >= 0 ? '+' : ''}${progress.momentumDelta}, from ${war.momentum} to ${projectedMomentum} (positive favors ${attackerName}, negative favors ${defenderName}).`
  )
  if (resolution.resolves) {
    reasoning.push(
      resolution.outcome === 'stalemate'
        ? `This crosses the ${WAR_MAX_DURATION}-turn mark (started turn ${war.startedTurn}) without a decisive swing — the war would end in a stalemate.`
        : `This crosses the decisive threshold (±${WAR_DECISIVE_MOMENTUM}) — ${resolution.outcome === 'attacker' ? attackerName : defenderName} would win outright.`
    )
  } else {
    const marginNeeded = WAR_DECISIVE_MOMENTUM - Math.abs(projectedMomentum)
    const turnsUntilStalemate = WAR_MAX_DURATION - turnsElapsed
    reasoning.push(
      `Still ${marginNeeded} short of a decisive swing (±${WAR_DECISIVE_MOMENTUM}), and ${turnsUntilStalemate} turn(s) away from being called a stalemate.`
    )
  }

  return { currentMomentum: war.momentum, projectedMomentum, turnsElapsed, reasoning }
}

export interface WarJoinCandidate {
  id: string
  name: string
  military: number
  /**
   * Optional gates mirroring the declaration gates in
   * decideWarDeclaration: a joiner with a dovish leader, a DEFAULTED
   * debt, or LOW influence sits the war out for the same reasons an
   * attacker would. Absent fields keep the pre-gate behavior exactly.
   */
  leaderAmbition?: number
  isDefaulted?: boolean
  influence?: number
}

// Picks at most one ally to join a side this tick — a coalition grows one
// faction at a time, not in one instant blob. Deterministic: strongest
// eligible candidate wins, ties broken by id so the same input always
// produces the same pick.
/** Pure decision function — no DB access, safe to unit test directly. */
export function decideWarJoiner(candidates: WarJoinCandidate[]): WarJoinCandidate | null {
  const eligible = candidates.filter(
    (c) =>
      c.military >= WAR_MILITARY_THRESHOLD &&
      (c.leaderAmbition === undefined || c.leaderAmbition >= MEDIUM_BAND_MIN) &&
      !c.isDefaulted &&
      (c.influence === undefined || c.influence >= INFLUENCE_DECLARATION_FLOOR)
  )
  if (eligible.length === 0) return null
  return eligible.sort((a, b) => b.military - a.military || a.id.localeCompare(b.id))[0]
}

type ActiveWar = Prisma.WarGetPayload<{
  include: { attacker: true; defender: true; participants: { include: { faction: { include: typeof TIE_INCLUDE } } } }
}>

export async function tickWars(ctx: TickContext): Promise<TickHandlerResult> {
  const activeWars = await ctx.db.war.findMany({
    where: { campaignId: ctx.campaignId, status: 'ESCALATING' },
    include: {
      attacker: true,
      defender: true,
      // #373: a coalition grows through a participant's ALLY ties, which
      // are edge rows now rather than a column on the faction.
      participants: { include: { faction: { include: TIE_INCLUDE } } },
    },
  })

  const factionIdsAtWar = new Set<string>()
  for (const war of activeWars) {
    for (const p of war.participants) factionIdsAtWar.add(p.factionId)
  }

  // Three distinct jobs, run in this order: settle the wars already
  // underway, let the survivors' allies pile on, then see whether any new
  // war ignites — each phase's output (who's resolved, who's now at war)
  // feeds the next.
  const progress = await resolveWarProgress(ctx, activeWars)
  const coalitionChanges = await growWarCoalitions(ctx, activeWars, factionIdsAtWar, progress.resolvedWarIds)
  const declarationChanges = await declareNewWars(ctx, factionIdsAtWar)

  return { changes: [...progress.changes, ...coalitionChanges, ...declarationChanges] }
}

/**
 * Settle every currently-ESCALATING war: apply momentum/attrition, and
 * resolve any that reach a decisive swing or their max duration. Returns
 * which wars resolved this tick so growWarCoalitions can skip them.
 */
async function resolveWarProgress(
  ctx: TickContext,
  activeWars: ActiveWar[]
): Promise<{ changes: WorldChange[]; resolvedWarIds: Set<string> }> {
  const changes: WorldChange[] = []
  const resolvedWarIds = new Set<string>()

  // The tick orders handlers so weatherTick has already written this turn's
  // weather onto locations — read the contested grounds' weather once,
  // batched, so severe weather can bleed the fighting armies (decideWarProgress).
  const contestedIds = activeWars
    .map((w) => w.contestedLocationId)
    .filter((id): id is string => id !== null)
  const contestedWeather = new Map<string, { condition: WeatherCondition; severity: number }>()
  const contestedCondition = new Map<string, number>()
  if (contestedIds.length > 0) {
    const contestedLocations = await ctx.db.location.findMany({
      where: { id: { in: contestedIds }, campaignId: ctx.campaignId },
      select: { id: true, weather: true, weatherSeverity: true, conditionScore: true },
    })
    for (const l of contestedLocations) {
      contestedWeather.set(l.id, { condition: l.weather, severity: l.weatherSeverity })
      contestedCondition.set(l.id, l.conditionScore)
    }
  }

  // Supply snapshot for the no-route attrition: tickLogistics runs AFTER
  // tickWars in the handler order, so the snapshot is built here rather
  // than reused. Routes, ownership, and weather are all read batched once.
  const [supplyRoutes, supplyLocations] = await Promise.all([
    ctx.db.supplyRoute.findMany({
      where: { campaignId: ctx.campaignId },
      select: { fromLocationId: true, toLocationId: true, isBlockaded: true },
    }),
    ctx.db.location.findMany({
      where: { campaignId: ctx.campaignId },
      select: { id: true, ownerFactionId: true, weather: true, weatherSeverity: true },
    }),
  ])
  const supplyOwnerByLocationId = new Map(supplyLocations.map((l) => [l.id, l.ownerFactionId]))
  const supplyWeatherByLocationId = new Map(
    supplyLocations.map((l) => [l.id, { condition: l.weather, severity: l.weatherSeverity }])
  )
  const supplyOwnedCounts = new Map<string, number>()
  for (const l of supplyLocations) {
    if (!l.ownerFactionId) continue
    supplyOwnedCounts.set(l.ownerFactionId, (supplyOwnedCounts.get(l.ownerFactionId) ?? 0) + 1)
  }

  for (const war of activeWars) {
    const attackerSide = war.participants.filter((p) => p.side === 'ATTACKER' && p.faction.isActive)
    const defenderSide = war.participants.filter((p) => p.side === 'DEFENDER' && p.faction.isActive)
    const sideDescriptor = (primary: string, side: typeof attackerSide) =>
      side.length > 1 ? `${primary} and ${side.length - 1} ${side.length === 2 ? 'ally' : 'allies'}` : primary

    // A side with zero living participants ends the war outright — there's
    // no one left to fight on that side. The survivor (if any) simply keeps
    // whatever it already held. Kept as a 'stalemate' outcome (not a win)
    // for the surviving side, same labeling the original 1v1 version used —
    // a side dying off mid-war isn't the same as being decisively beaten.
    if (attackerSide.length === 0 || defenderSide.length === 0) {
      resolvedWarIds.add(war.id)
      if (!ctx.dryRun) {
        await ctx.db.war.update({
          where: { id: war.id },
          data: { status: 'RESOLVED', outcome: 'stalemate', resolvedTurn: ctx.turnNumber },
        })
        if (war.contestedLocationId) {
          // updateMany, not update: this is a "lift the siege if that place
          // still exists" write, and update throws P2025 on a missing row.
          // The FK added alongside this makes a dangling id impossible at
          // rest, but the war row was read earlier in the tick, so a delete
          // landing in between would still take the whole turn down.
          await ctx.db.location.updateMany({ where: { id: war.contestedLocationId }, data: { isContested: false } })
        }
      }
      changes.push({
        entityType: 'FACTION',
        entityId: attackerSide.length > 0 ? war.attackerFactionId : war.defenderFactionId,
        entityName: attackerSide.length > 0 ? war.attacker.name : war.defender.name,
        campaignId: ctx.campaignId,
        field: 'warEnded',
        previousValue: 'escalating',
        newValue: 'ended',
        reason: `The war between ${war.attacker.name} and ${war.defender.name} ends when one side collapses`,
        significant: true,
        importance: 'MAJOR',
        originLocationId: war.contestedLocationId ?? null,
      })
      continue
    }

    const attackerMilitaryTotal = attackerSide.reduce((sum, p) => sum + p.faction.military, 0)
    const defenderMilitaryTotal = defenderSide.reduce((sum, p) => sum + p.faction.military, 0)

    // The attacker needs a working supply route to the front — evaluated
    // from the attacker's perspective: a route touching the contested
    // location whose other end the attacker owns. strictForeignFront: a
    // lone home location does not supply an army fighting on foreign
    // ground. No route, the attacker bleeds extra; the defender fights on
    // home ground.
    const attackerSupplyCut = war.contestedLocationId
      ? !hasWorkingRoute(
          war.contestedLocationId,
          war.attackerFactionId,
          supplyRoutes,
          supplyOwnerByLocationId,
          supplyOwnedCounts.get(war.attackerFactionId) ?? 0,
          supplyWeatherByLocationId,
          { strictForeignFront: true }
        )
      : false

    const progress = decideWarProgress(
      war,
      { military: attackerMilitaryTotal },
      { military: defenderMilitaryTotal },
      ctx.turnNumber,
      war.contestedLocationId ? contestedWeather.get(war.contestedLocationId) : undefined,
      war.contestedLocationId ? contestedCondition.get(war.contestedLocationId) : undefined,
      attackerSupplyCut,
      // ctx.season is the calendar's own season (same value
      // locationConditionTick reads) — winter campaigns bleed both sides.
      ctx.season
    )
    const newMomentum = clamp(war.momentum + progress.momentumDelta, -100, 100)

    // Attrition applies to every living participant on both sides, not just
    // the original two — a coalition shares the cost of fighting.
    if (!ctx.dryRun) {
      for (const p of attackerSide) {
        await ctx.db.faction.update({
          where: { id: p.factionId },
          data: {
            resources: clamp(p.faction.resources + progress.attackerResourceDelta, 0, 100),
            military: clamp(p.faction.military + progress.attackerMilitaryDelta, 0, 100),
          },
        })
      }
      for (const p of defenderSide) {
        await ctx.db.faction.update({
          where: { id: p.factionId },
          data: {
            resources: clamp(p.faction.resources + progress.defenderResourceDelta, 0, 100),
            military: clamp(p.faction.military + progress.defenderMilitaryDelta, 0, 100),
          },
        })
      }
    }

    const turnsElapsed = ctx.turnNumber - war.startedTurn
    const resolution = decideWarResolution(newMomentum, turnsElapsed)

    if (!resolution.resolves) {
      if (!ctx.dryRun) {
        await ctx.db.war.update({ where: { id: war.id }, data: { momentum: newMomentum } })
      }
      continue
    }

    resolvedWarIds.add(war.id)

    if (!ctx.dryRun) {
      await ctx.db.war.update({
        where: { id: war.id },
        data: { momentum: newMomentum, status: 'RESOLVED', outcome: resolution.outcome, resolvedTurn: ctx.turnNumber },
      })
    }

    let contestedLocationName: string | null = null
    if (war.contestedLocationId) {
      const contestedLocation = await ctx.db.location.findUnique({ where: { id: war.contestedLocationId } })
      contestedLocationName = contestedLocation?.name ?? null

      // Guarded on the row we just fetched: the findUnique above was only
      // being read for the name, so a contested Location that had gone
      // missing still fell through to an update that throws P2025 — mid-tick,
      // with no transaction to roll the rest of the turn back.
      if (!ctx.dryRun && contestedLocation) {
        if (resolution.outcome === 'attacker') {
          // The prize goes only to the original attacker — an ally fighting
          // alongside doesn't inherit territory it never personally claimed.
          await ctx.db.location.update({
            where: { id: war.contestedLocationId },
            data: { ownerFactionId: war.attackerFactionId, isContested: false },
          })
        } else {
          // Defender holds, or it's a stalemate — either way the siege lifts.
          await ctx.db.location.update({ where: { id: war.contestedLocationId }, data: { isContested: false } })
        }
      }
    }

    // The losing SIDE takes a stability hit beyond the attrition it already
    // paid every turn — losing a war costs more than fighting one. Applies
    // to every faction on the losing side, not just the primary — a
    // coalition shares the cost of losing too.
    //
    // #218: `influence` moves alongside stability here too — it's the one
    // tracked stat war outcomes never touched, despite standing.ts's own
    // doc comment naming exactly this scenario ("LOW influence, e.g. bled
    // dry by a lost war") as the reason effectiveStandingModifier caps
    // harder for a low-influence faction. A decisive win also raises a
    // faction's regional standing, not just its loot — smaller than the
    // loser's hit, since winning a war doesn't cost the loser's full loss.
    // A stalemate moves neither; nobody's regional standing shifted.
    if (!ctx.dryRun) {
      if (resolution.outcome === 'attacker') {
        for (const p of defenderSide) {
          await ctx.db.faction.update({ where: { id: p.factionId }, data: { stability: clamp(p.faction.stability - 10, 0, 100), influence: clamp(p.faction.influence - 8, 0, 100) } })
        }
        for (const p of attackerSide) {
          await ctx.db.faction.update({ where: { id: p.factionId }, data: { influence: clamp(p.faction.influence + 4, 0, 100) } })
        }
      } else if (resolution.outcome === 'defender') {
        for (const p of attackerSide) {
          await ctx.db.faction.update({ where: { id: p.factionId }, data: { stability: clamp(p.faction.stability - 10, 0, 100), influence: clamp(p.faction.influence - 8, 0, 100) } })
        }
        for (const p of defenderSide) {
          await ctx.db.faction.update({ where: { id: p.factionId }, data: { influence: clamp(p.faction.influence + 4, 0, 100) } })
        }
      }
    }

    const attackerDescriptor = sideDescriptor(war.attacker.name, attackerSide)
    const defenderDescriptor = sideDescriptor(war.defender.name, defenderSide)
    const reasonByOutcome = {
      attacker: `${attackerDescriptor} wins its war against ${defenderDescriptor}${contestedLocationName ? `, seizing ${contestedLocationName}` : ''}`,
      defender: `${defenderDescriptor} repels ${attackerDescriptor}'s war, holding its ground`,
      stalemate: `The war between ${attackerDescriptor} and ${defenderDescriptor} grinds to a stalemate after ${turnsElapsed} turns`,
    } as const

    changes.push({
      entityType: 'FACTION',
      entityId: war.attackerFactionId,
      entityName: war.attacker.name,
      campaignId: ctx.campaignId,
      field: 'warResolved',
      previousValue: 'escalating',
      newValue: resolution.outcome!,
      reason: reasonByOutcome[resolution.outcome!],
      significant: true,
      importance: 'MAJOR',
      originLocationId: war.contestedLocationId ?? null,
    })
  }

  return { changes, resolvedWarIds }
}

/**
 * Let each side of an ongoing (not just-resolved) war pull in one
 * already-idle ally, if one is strong enough. A faction is eligible only if
 * it's allied with a CURRENT side member, active, meets the same military
 * bar declaration itself requires, and isn't already committed to any war
 * (this one or another) — factionIdsAtWar tracks that globally, and is
 * mutated here as joiners are added so declareNewWars sees them too.
 */
async function growWarCoalitions(
  ctx: TickContext,
  activeWars: ActiveWar[],
  factionIdsAtWar: Set<string>,
  resolvedWarIds: Set<string>
): Promise<WorldChange[]> {
  const changes: WorldChange[] = []

  for (const war of activeWars) {
    if (resolvedWarIds.has(war.id)) continue

    for (const side of ['ATTACKER', 'DEFENDER'] as const) {
      const sideParticipants = war.participants.filter((p) => p.side === side && p.faction.isActive)
      const sideFactionIds = new Set(sideParticipants.map((p) => p.factionId))

      const candidateIds = new Set<string>()
      for (const p of sideParticipants) {
        const relationships = factionTies(p.faction)
        for (const [otherId, rel] of Object.entries(relationships)) {
          if (rel.type === 'ALLY' && !sideFactionIds.has(otherId) && !factionIdsAtWar.has(otherId)) {
            candidateIds.add(otherId)
          }
        }
      }

      if (candidateIds.size === 0) continue

      const candidateFactions = await ctx.db.faction.findMany({
        where: { id: { in: Array.from(candidateIds) }, campaignId: ctx.campaignId, isActive: true },
        select: { id: true, name: true, military: true, influence: true },
      })
      if (candidateFactions.length === 0) continue

      // Joiners honor the same gates declarations do: a dovish leader, a
      // DEFAULTED debt, or LOW influence keeps a faction out of someone
      // else's war too. Batched per candidate set, same query shape
      // declareNewWars uses for the declaration pass.
      const candidateIdList = candidateFactions.map((f) => f.id)
      const [candidateLeaderRows, candidateDefaultedDebts] = await Promise.all([
        ctx.db.nPC.findMany({
          where: {
            campaignId: ctx.campaignId,
            isAlive: true,
            factionId: { in: candidateIdList },
            factionRole: 'LEADER',
          },
          select: { factionId: true, disposition: true },
        }),
        ctx.db.factionDebt.findMany({
          where: { campaignId: ctx.campaignId, status: 'DEFAULTED', debtorFactionId: { in: candidateIdList } },
          select: { debtorFactionId: true },
        }),
      ])
      const candidateAmbitionByFaction = new Map<string, number>()
      for (const row of candidateLeaderRows) {
        if (!row.factionId || candidateAmbitionByFaction.has(row.factionId)) continue
        candidateAmbitionByFaction.set(
          row.factionId,
          parseDisposition(row.disposition)?.ambition ?? NEUTRAL_DISPOSITION.ambition
        )
      }
      const candidateDefaultedIds = new Set(candidateDefaultedDebts.map((d) => d.debtorFactionId))

      const remainingCandidates: WarJoinCandidate[] = candidateFactions.map((f) => ({
        id: f.id,
        name: f.name,
        military: f.military,
        influence: f.influence,
        leaderAmbition: candidateAmbitionByFaction.get(f.id),
        isDefaulted: candidateDefaultedIds.has(f.id),
      }))
      let joined = 0
      while (joined < MAX_JOINERS_PER_SIDE_PER_TICK) {
        const joiner = decideWarJoiner(remainingCandidates)
        if (!joiner) break

        if (!ctx.dryRun) {
          await ctx.db.warParticipant.create({
            data: { warId: war.id, factionId: joiner.id, side, joinedTurn: ctx.turnNumber },
          })
        }
        factionIdsAtWar.add(joiner.id)
        joined++

        const primaryOpponentName = side === 'ATTACKER' ? war.defender.name : war.attacker.name
        changes.push({
          entityType: 'FACTION',
          entityId: joiner.id,
          entityName: joiner.name,
          campaignId: ctx.campaignId,
          field: 'warJoined',
          previousValue: 'ally',
          newValue: `at war (${side.toLowerCase()})`,
          reason: `${joiner.name} joins the war against ${primaryOpponentName} in support of its ally`,
          significant: true,
          importance: 'MAJOR',
          originLocationId: war.contestedLocationId ?? null,
        })

        const index = remainingCandidates.findIndex((c) => c.id === joiner.id)
        if (index >= 0) remainingCandidates.splice(index, 1)
      }
    }
  }

  return changes
}

/**
 * Declare new wars among rival pairs not already fighting each other, where
 * one side's territory is already contested by the other. `factionIdsAtWar`
 * is mutated as new wars ignite, reflecting everyone tickWars has already
 * committed to a war this tick (pre-existing participants plus this tick's
 * coalition joiners).
 */
async function declareNewWars(ctx: TickContext, factionIdsAtWar: Set<string>): Promise<WorldChange[]> {
  const changes: WorldChange[] = []

  const factions = await ctx.db.faction.findMany({
    where: { campaignId: ctx.campaignId, isActive: true, ...rosterFactionFilter(ctx) },
    include: TIE_INCLUDE,
  })

  const locations = await ctx.db.location.findMany({
    where: { campaignId: ctx.campaignId },
    select: { id: true, name: true, ownerFactionId: true, isContested: true },
  })

  // #79: the world remembers its own wars. Loaded once for the whole pass
  // rather than per pair — this is the read that was missing, not a new
  // write; resolvedTurn and outcome have been recorded since wars existed.
  const priorWars = await ctx.db.war.findMany({
    where: { campaignId: ctx.campaignId, status: 'RESOLVED' },
    select: { attackerFactionId: true, defenderFactionId: true, resolvedTurn: true, outcome: true },
  })

  // The attacker's leader ambition gates declarations — same batched query
  // shape as ambitionTick. An NPC leader is the row with factionRole
  // 'LEADER'; a PC-led or leaderless faction has no NPC disposition to
  // read and keeps the pre-gate behavior (neutral).
  const leaderRows = await ctx.db.nPC.findMany({
    where: {
      campaignId: ctx.campaignId,
      isAlive: true,
      factionId: { in: factions.map((f) => f.id) },
      factionRole: 'LEADER',
    },
    select: { factionId: true, disposition: true },
  })
  const leaderAmbitionByFaction = new Map<string, number>()
  const leaderSelfPreservationByFaction = new Map<string, number>()
  for (const row of leaderRows) {
    if (!row.factionId || leaderAmbitionByFaction.has(row.factionId)) continue
    const disposition = parseDisposition(row.disposition)
    leaderAmbitionByFaction.set(row.factionId, disposition?.ambition ?? NEUTRAL_DISPOSITION.ambition)
    // The same disposition row already fetched for the ambition gate also
    // carries self-preservation — one read, two gates.
    leaderSelfPreservationByFaction.set(
      row.factionId,
      disposition?.selfPreservation ?? NEUTRAL_DISPOSITION.selfPreservation
    )
  }

  // A DEFAULTED debtor can't fund a war of conquest — one batched read
  // for the whole declaration pass.
  const defaultedDebts = await ctx.db.factionDebt.findMany({
    where: { campaignId: ctx.campaignId, status: 'DEFAULTED', debtorFactionId: { in: factions.map((f) => f.id) } },
    select: { debtorFactionId: true },
  })
  const defaultedFactionIds = new Set(defaultedDebts.map((d) => d.debtorFactionId))

  for (const defender of factions) {
    if (factionIdsAtWar.has(defender.id)) continue

    const rivalId = findRivalId(factionTies(defender))
    if (!rivalId || factionIdsAtWar.has(rivalId)) continue

    const attacker = factions.find((f) => f.id === rivalId)
    if (!attacker) continue

    const decision = decideWarDeclaration(
      {
        // goal and stability ride along on the spread — the full faction
        // row already carries them, so the goal and stability gates need
        // no extra reads.
        ...attacker,
        leaderAmbition: leaderAmbitionByFaction.get(attacker.id),
        leaderSelfPreservation: leaderSelfPreservationByFaction.get(attacker.id),
        isDefaulted: defaultedFactionIds.has(attacker.id),
      },
      defender,
      locations,
      {
        priorWars,
        currentTurn: ctx.turnNumber,
      }
    )
    if (!decision.shouldDeclare) {
      if (decision.exhaustionRemaining) {
        console.log(
          `  🕊️ ${attacker.name} vs ${defender.name}: still war-weary for ${decision.exhaustionRemaining} more turn(s)`
        )
      } else if (decision.influenceHesitation) {
        console.log(
          `  🕊️ ${attacker.name} vs ${defender.name}: influence too low to rally for a new war (${attacker.influence})`
        )
      } else if (decision.dovishLeader) {
        console.log(
          `  🕊️ ${attacker.name} vs ${defender.name}: leader lacks the ambition to start a war (${leaderAmbitionByFaction.get(attacker.id)})`
        )
      } else if (decision.defaultedDebt) {
        console.log(
          `  🕊️ ${attacker.name} vs ${defender.name}: defaulted on its debts — cannot fund a war`
        )
      } else if (decision.threatDeterrence) {
        console.log(
          `  🕊️ ${attacker.name} vs ${defender.name}: deterred by ${defender.name}'s threat level (${defender.threatLevel})`
        )
      } else if (decision.goalMismatch) {
        console.log(
          `  🕊️ ${attacker.name} vs ${defender.name}: goal is ${attacker.goal} — not an offensive war goal`
        )
      } else if (decision.stabilityHesitation) {
        console.log(
          `  🕊️ ${attacker.name} vs ${defender.name}: too unstable at home to start a war (${attacker.stability})`
        )
      } else if (decision.selfPreservationVeto) {
        console.log(
          `  🕊️ ${attacker.name} vs ${defender.name}: leader's self-preservation vetoes a war of choice (${leaderSelfPreservationByFaction.get(attacker.id)})`
        )
      }
      continue
    }

    const prizeLocation = locations.find((l) => l.id === decision.contestedLocationId)

    if (!ctx.dryRun) {
      const createdWar = await ctx.db.war.create({
        data: {
          campaignId: ctx.campaignId,
          name: prizeLocation ? `War for ${prizeLocation.name}` : `${attacker.name} vs. ${defender.name}`,
          attackerFactionId: attacker.id,
          defenderFactionId: defender.id,
          contestedLocationId: decision.contestedLocationId,
          startedTurn: ctx.turnNumber,
        },
      })
      await ctx.db.warParticipant.createMany({
        data: [
          { warId: createdWar.id, factionId: attacker.id, side: 'ATTACKER', joinedTurn: ctx.turnNumber },
          { warId: createdWar.id, factionId: defender.id, side: 'DEFENDER', joinedTurn: ctx.turnNumber },
        ],
      })
    }

    factionIdsAtWar.add(attacker.id)
    factionIdsAtWar.add(defender.id)

    changes.push({
      entityType: 'FACTION',
      entityId: attacker.id,
      entityName: attacker.name,
      campaignId: ctx.campaignId,
      field: 'warDeclared',
      previousValue: 'rivals',
      newValue: 'at war',
      reason: `${attacker.name} declares war on ${defender.name}, both sides strong enough to see it through`,
      significant: true,
      importance: 'MAJOR',
      originLocationId: decision.contestedLocationId ?? null,
    })
  }

  return changes
}
