// src/lib/game/tick/npcTick.ts
// World Sim Phase 1 — major NPC goals.
//
// "Major" = NPC.importance >= 4, matching the threshold already used
// elsewhere in the codebase (src/lib/ai/worldState.ts filters NPCs into the
// AI context the same way: `npc.importance >= 4`). Minor NPCs stay inert —
// they're never touched by the tick. Capped at 20 major NPCs per campaign.
//
// Each major NPC cycles through a small deterministic plan-phase schedule
// (observing -> preparing -> acting -> resting) whose pace is stable per
// NPC (derived from a hash of their id, not randomness) and whose phase
// text incorporates a time-of-day derived from the tick's turn number,
// their goal, and their current relationship note. Movement between a
// "home" and "work" location is a simple day/night commute — only possible
// once the campaign has at least 2 discovered locations to commute between.
//
// World Sim Phase 4: an NPC affiliated with a faction (see NPC.factionId)
// has that faction's current goal woven into their plan text, so their
// flavor reflects what the organization they serve is actually up to this
// turn. Leadership succession and defection on faction collapse live in
// leadershipTick.ts and factionTick.ts respectively, not here.

import type { NPC } from '@prisma/client'
import { TickContext, TickHandlerResult, WorldChange, stableHash } from './types'
import { AdjacencyEdge, directNeighborsOf } from '../worldGraph'
import { TIMES_OF_DAY, timeOfDayFromHours, type TimeOfDay as CalendarTimeOfDay } from '../calendar'
import { rosterNpcFilter } from './capOrdering'

// Exported so other systems that touch NPC.importance (e.g. consequence-driven
// escalation in src/lib/game/consequences.ts) use the exact same cutoff for
// "major" rather than redefining it.
export const MAJOR_IMPORTANCE_THRESHOLD = 4

// #402: the vocabulary and the derivation both live in calendar.ts now —
// see timeOfDayFromHours. This file used to define its own, keyed to the
// turn counter, which is a different clock entirely.
type TimeOfDay = CalendarTimeOfDay

const PLAN_PHASES = ['observing', 'preparing', 'acting', 'resting'] as const
type PlanPhase = (typeof PLAN_PHASES)[number]

/**
 * #402: derived from the in-fiction clock, not from the turn counter.
 *
 * This was `TIME_OF_DAY[turnNumber % 4]`, a second, independent notion of
 * time of day that nothing reconciled with the date the player is shown.
 * An NPC's working day ran on a clock unrelated to the fiction's own — and
 * with a frozen turn counter it did not run at all: evening/night froze
 * every major NPC in place forever, morning/afternoon relocated every NPC
 * on every tick forever.
 *
 * `totalElapsedGameHours` is the durable source of truth the calendar
 * itself reads (see calendar.ts's header). Falls back to a turn-derived
 * value only when a caller genuinely has no hours to offer, which is unit
 * tests — the real tick always does.
 */
export function deriveTimeOfDay(turnNumber: number, totalElapsedGameHours?: number): TimeOfDay {
  if (totalElapsedGameHours !== undefined) return timeOfDayFromHours(totalElapsedGameHours)
  return TIMES_OF_DAY[((turnNumber % TIMES_OF_DAY.length) + TIMES_OF_DAY.length) % TIMES_OF_DAY.length]
}

// Each NPC gets a stable "tempo" (2-4 ticks per phase) so schedules feel
// varied across a cast without any run-to-run randomness.
function tempoFor(npcId: string): number {
  return 2 + (stableHash(npcId) % 3)
}

function phaseIndexAt(npcId: string, turnNumber: number): number {
  const tempo = tempoFor(npcId)
  return Math.floor(turnNumber / tempo) % PLAN_PHASES.length
}

// Exported for npcSocietyTick.ts: joint schemes trigger when two allied
// NPCs' independently-paced schedules happen to converge on "acting" the
// same turn — reusing this exact cycle (not a separate one) keeps "acting"
// meaning the same thing everywhere a phase is checked.
export function isActingPhase(npcId: string, turnNumber: number): boolean {
  return PLAN_PHASES[phaseIndexAt(npcId, turnNumber)] === 'acting'
}

// Deterministic pace: a goal takes 25 ticks of active pursuit to complete.
// Long enough that background arcs feel like they're actually unfolding
// over the campaign, short enough that a major NPC's goal completes within
// a realistic playthrough instead of never.
const PROGRESS_PER_TICK = 4

// Phase weighting: without this, three of the four plan phases
// (observing/preparing/resting) contributed nothing beyond flavor text —
// goalProgress accrued identically regardless of what an NPC was
// nominally doing. Now progress tracks the phase itself: an NPC actually
// executing their plan ("acting") advances fastest, one laying groundwork
// ("preparing") advances at the baseline rate, and one gathering intel or
// recovering (observing/resting) barely advances at all. Weights are
// chosen to average to exactly 1.0 across a full 4-phase cycle (2+4+8+2)/4
// = 4), so the ~25-tick completion pace documented above is unchanged for
// an NPC averaged over time — only the per-tick distribution changed, not
// the overall cadence.
const PHASE_PROGRESS_WEIGHT: Record<PlanPhase, number> = {
  observing: 0.5,
  preparing: 1,
  acting: 2,
  resting: 0.5,
}

export interface NpcTickDecision {
  phase: PlanPhase
  timeOfDay: TimeOfDay
  planPhaseChanged: boolean
  currentPlan: string
  nextLocation: string | null // null = no change
  newGoalProgress: number
  goalCompleted: boolean
}

/** #108: maps discovered location names to ids, plus the adjacency edges
 * between them — optional. Omitted (or a home location with no adjacency
 * data at all), decideNpcTick falls back to its exact pre-#108 hash-rotation
 * "work" pick, so a campaign with no backfilled graph yet behaves
 * identically to before.
 *
 * `contestedIds` (also optional) marks locations with an active war on
 * their doorstep — NPCs avoid picking contested work destinations, and
 * make slower goal progress while stuck in one. Absent, contested ground
 * is invisible to the routine, exactly as before.
 *
 * `warZoneIds` (also optional) extends the SLOWDOWN only — locations
 * owned by a faction fighting an ESCALATING war. Armies marching through
 * the owner's territory disrupt the work even where no prize is being
 * contested. Deliberately NOT part of work-destination avoidance: an
 * NPC still commutes into war-zone ground, they just work at half
 * speed while there. */
export interface NpcLocationGraph {
  idByName: Map<string, string>
  edges: AdjacencyEdge[]
  contestedIds?: ReadonlySet<string>
  warZoneIds?: ReadonlySet<string>
}

// Working a war zone — the NPC's current location is either a contested
// war prize (contestedIds) or owned by a faction fighting an ESCALATING
// war (warZoneIds) — halves goal progress, as does serving a faction
// that no longer exists as an independent actor. You can't get much
// done with armies marching through, or when the institution you served
// has collapsed out from under you.
const CONTESTED_PROGRESS_MULTIPLIER = 0.5

/** Pure decision function — no DB access, safe to unit test directly. */
export function decideNpcTick(
  npc: { id: string; goals: string | null; relationship: string | null; currentLocation: string | null; goalProgress: number },
  turnNumber: number,
  discoveredLocationNames: string[],
  // World Sim Phase 4: an affiliated major NPC's plan reflects their
  // faction's current strategic posture, so "serving Iron Crown" reads
  // differently while that faction is pursuing EXPAND vs. DEFEND — the
  // affiliation isn't just a foreign key, it colors the NPC's own flavor text.
  //
  // isActive distinguishes "no faction" (null — truly unaffiliated, never
  // penalized for faction state) from "affiliated with a collapsed one"
  // (object with isActive: false — goal progress suffers). Optional and
  // defaulting to active, so older callers that pass a faction object keep
  // their exact behavior. The flavor note only names a living faction; a
  // dead one's posture is stale text.
  faction: { name: string; goal: string; isActive?: boolean } | null = null,
  locationGraph?: NpcLocationGraph,
  // #402: the in-fiction clock. Time of day comes from here, not from the
  // turn counter — see deriveTimeOfDay.
  totalElapsedGameHours?: number
): NpcTickDecision {
  const timeOfDay = deriveTimeOfDay(turnNumber, totalElapsedGameHours)
  const phaseIndex = phaseIndexAt(npc.id, turnNumber)
  const prevPhaseIndex = turnNumber > 0 ? phaseIndexAt(npc.id, turnNumber - 1) : -1
  const phase = PLAN_PHASES[phaseIndex]

  const goalText = npc.goals?.trim() || 'no clear goal'
  const relationshipNote = npc.relationship?.trim()
  const factionNote = faction && faction.isActive !== false ? ` [${faction.name}, pursuing ${faction.goal}]` : ''
  const currentPlan = relationshipNote
    ? `${phase} (${timeOfDay}): ${goalText} — mindful of ${relationshipNote}${factionNote}`
    : `${phase} (${timeOfDay}): ${goalText}${factionNote}`

  const contestedIds = locationGraph?.contestedIds
  const warZoneIds = locationGraph?.warZoneIds
  const isContestedName = (name: string): boolean => {
    if (!contestedIds) return false
    const id = locationGraph!.idByName.get(name)
    return id !== undefined && contestedIds.has(id)
  }
  // War-zone membership (location owned by a faction fighting an
  // ESCALATING war) counts for the progress slowdown but never for
  // work-destination avoidance — see NpcLocationGraph.warZoneIds.
  const isWarZoneName = (name: string): boolean => {
    if (!warZoneIds) return false
    const id = locationGraph!.idByName.get(name)
    return id !== undefined && warZoneIds.has(id)
  }

  let nextLocation: string | null = null
  const sorted = [...new Set(discoveredLocationNames)].sort()
  if (sorted.length >= 2) {
    const currentIdx = npc.currentLocation ? sorted.indexOf(npc.currentLocation) : -1
    const homeIdx = currentIdx !== -1 ? currentIdx : stableHash(npc.id) % sorted.length
    const homeName = sorted[homeIdx]

    // #108: "work" is a REAL neighbor of home when adjacency data covers
    // it — real nearest-neighbor selection instead of a blind hash
    // rotation through every discovered location regardless of distance.
    let workName: string | undefined
    const homeId = locationGraph?.idByName.get(homeName)
    if (homeId) {
      const neighborNames = directNeighborsOf(locationGraph!.edges, homeId)
        .map((id) => sorted.find((name) => locationGraph!.idByName.get(name) === id))
        // Nobody commutes INTO a war zone for their day job when a
        // quieter neighbor exists — contested neighbors are skipped.
        .filter((name): name is string => !!name && name !== homeName && !isContestedName(name))
      if (neighborNames.length > 0) {
        const sortedNeighbors = [...new Set(neighborNames)].sort()
        workName = sortedNeighbors[stableHash(`${npc.id}:work`) % sortedNeighbors.length]
      }
    }
    // Fallback: the exact pre-#108 hash-rotation pick, unchanged, used
    // whenever adjacency data doesn't cover this home location at all —
    // except that it now also steps over contested ground when the
    // contested set is known, rather than marching into a war zone out of
    // habit. When every discovered location is contested (or the set is
    // absent), the original pick stands: routine beats paralysis.
    if (!workName) {
      workName = sorted[(homeIdx + 1) % sorted.length]
      if (contestedIds && isContestedName(workName)) {
        for (let k = 2; k <= sorted.length; k++) {
          const candidate = sorted[(homeIdx + k) % sorted.length]
          if (!isContestedName(candidate)) {
            workName = candidate
            break
          }
        }
      }
    }

    const isActiveHours = timeOfDay === 'morning' || timeOfDay === 'afternoon'
    const desired = isActiveHours ? workName : homeName
    if (desired !== npc.currentLocation) {
      nextLocation = desired
    }
  }

  // Goalless NPCs (goals cleared, awaiting AI narration to assign a new
  // one — see goalCompleted handling below) don't accrue progress toward
  // nothing.
  const hasGoal = !!npc.goals?.trim()
  const currentLocationContested = !!npc.currentLocation && isContestedName(npc.currentLocation)
  // A location owned by a faction fighting an ESCALATING war slows the
  // NPC down even when nothing is contested on the location itself —
  // armies marching through the owner's territory still disrupt the
  // work. Work-destination avoidance deliberately stays contested-only
  // (see isContestedName / NpcLocationGraph.warZoneIds).
  const currentLocationWarZone = !!npc.currentLocation && isWarZoneName(npc.currentLocation)
  // Truly unaffiliated NPCs (faction null) are never touched by the
  // faction clause — only an NPC whose faction exists but is inactive
  // works at half speed. isActive is optional and defaults to active, so
  // callers that pass a faction object without it keep prior behavior.
  const factionInactive = !!faction && faction.isActive === false
  const progressMultiplier = currentLocationContested || currentLocationWarZone || factionInactive ? CONTESTED_PROGRESS_MULTIPLIER : 1
  const rawProgress = hasGoal ? npc.goalProgress + PROGRESS_PER_TICK * PHASE_PROGRESS_WEIGHT[phase] * progressMultiplier : npc.goalProgress
  const goalCompleted = rawProgress >= 100
  const newGoalProgress = goalCompleted ? 0 : rawProgress

  return {
    phase,
    timeOfDay,
    planPhaseChanged: phaseIndex !== prevPhaseIndex,
    currentPlan,
    nextLocation,
    newGoalProgress,
    goalCompleted,
  }
}

export async function tickNpcs(ctx: TickContext): Promise<TickHandlerResult> {
  const [npcs, locations, adjacencyRows, warParticipants] = await Promise.all([
    ctx.db.nPC.findMany({
      where: { campaignId: ctx.campaignId, isAlive: true, importance: { gte: MAJOR_IMPORTANCE_THRESHOLD }, ...rosterNpcFilter(ctx) },
      // #283: importance desc is the intentional priority — most important
      // NPCs first. The rotation key breaks ties among equally-important
      // NPCs, so the same tied subset doesn't win the cap forever. See
      // capOrdering.ts.
      orderBy: [{ importance: 'desc' }, { id: 'asc' }],
      include: { faction: { select: { name: true, goal: true, isActive: true } } },
    }),
    ctx.db.location.findMany({
      where: { campaignId: ctx.campaignId, isDiscovered: true },
      // isContested is selected so NPC routines can avoid marching into
      // war zones for their work commute (see NpcLocationGraph), and
      // ownerFactionId so locations owned by a faction fighting an
      // ESCALATING war can slow goal progress even when uncontested.
      select: { id: true, name: true, isContested: true, ownerFactionId: true },
    }),
    // #108: optional input to decideNpcTick's "work" pick — falls back to
    // the pre-#108 hash rotation when this is empty or doesn't cover a
    // given home location.
    ctx.db.locationAdjacency.findMany({
      where: { campaignId: ctx.campaignId },
      select: { locationAId: true, locationBId: true, distance: true },
    }),
    // Active-war participants: a location owned by any of these factions
    // is war-zone ground for goal-progress purposes.
    ctx.db.warParticipant.findMany({
      where: { war: { campaignId: ctx.campaignId, status: 'ESCALATING' } },
      select: { factionId: true },
    }),
  ])

  const discoveredLocationNames = locations.map((l) => l.name)
  // The tick only ever moves an NPC to a name drawn from this same
  // `locations` fetch, so the id is always known here — keeps
  // NPC.locationId in sync with currentLocation the moment the tick moves
  // someone, the same as the AI write-back path does for PCs (see
  // #425 — Location stored as free text alongside the FK).
  const locationIdByName = new Map(locations.map((l) => [l.name, l.id]))
  const contestedIds = new Set(locations.filter((l) => l.isContested).map((l) => l.id))
  const participantFactionIds = new Set(warParticipants.map((p) => p.factionId))
  const warZoneIds = new Set(
    locations.filter((l) => l.ownerFactionId && participantFactionIds.has(l.ownerFactionId)).map((l) => l.id)
  )
  const locationGraph: NpcLocationGraph = { idByName: locationIdByName, edges: adjacencyRows as AdjacencyEdge[], contestedIds, warZoneIds }
  const changes: WorldChange[] = []

  for (const npc of npcs) {
    // Pass the affiliation through even when the faction is inactive —
    // decideNpcTick needs to tell "no faction" apart from "faction
    // collapsed" (the latter halves goal progress; the former is
    // untouched). The flavor note still only names living factions.
    const factionContext = npc.faction ? { name: npc.faction.name, goal: npc.faction.goal, isActive: npc.faction.isActive } : null
    const decision = decideNpcTick(npc, ctx.turnNumber, discoveredLocationNames, factionContext, locationGraph, ctx.totalElapsedGameHours)

    const updateData: { currentPlan: string; currentLocation?: string; locationId?: string; goalProgress: number } = {
      currentPlan: decision.currentPlan,
      goalProgress: decision.newGoalProgress,
    }
    if (decision.nextLocation) {
      updateData.currentLocation = decision.nextLocation
      const locationId = locationIdByName.get(decision.nextLocation)
      if (locationId) updateData.locationId = locationId
    }

    if (!ctx.dryRun) {
      await ctx.db.nPC.update({
        where: { id: npc.id },
        data: updateData,
      })
    }

    changes.push(...buildNpcChanges(ctx.campaignId, npc, decision))
  }

  return { changes }
}

function buildNpcChanges(campaignId: string, npc: NPC, decision: NpcTickDecision): WorldChange[] {
  const changes: WorldChange[] = []

  if (decision.planPhaseChanged) {
    changes.push({
      entityType: 'NPC',
      entityId: npc.id,
      entityName: npc.name,
      campaignId,
      field: 'currentPlan',
      previousValue: npc.currentPlan || '(none)',
      newValue: decision.currentPlan,
      reason: `${npc.name} moved into the "${decision.phase}" phase of pursuing: ${npc.goals || 'an unstated goal'}`,
      significant: true,
      importance: npc.importance >= 5 ? 'MAJOR' : 'NORMAL',
      originLocationId: npc.locationId,
    })
  }

  if (decision.nextLocation) {
    changes.push({
      entityType: 'NPC',
      entityId: npc.id,
      entityName: npc.name,
      campaignId,
      field: 'currentLocation',
      previousValue: npc.currentLocation || '(unknown)',
      newValue: decision.nextLocation,
      reason: `${npc.name} moved from ${npc.currentLocation || 'an unknown location'} to ${decision.nextLocation} following their ${decision.timeOfDay} schedule`,
      significant: true,
      importance: npc.importance >= 5 ? 'MAJOR' : 'NORMAL',
      originLocationId: npc.locationId,
    })
  }

  // Goal completed: always MAJOR, regardless of NPC importance tier — this
  // is the signal that picks the NPC up for AI narration + a new goal in
  // worldTurn.ts's generateOffscreenEvents, so it has to be unmissable.
  if (decision.goalCompleted) {
    changes.push({
      entityType: 'NPC',
      entityId: npc.id,
      entityName: npc.name,
      campaignId,
      field: 'goalCompleted',
      previousValue: npc.goals || '(no goal)',
      newValue: '(awaiting new direction)',
      reason: `${npc.name} has achieved their goal: ${npc.goals || 'an unstated goal'}`,
      significant: true,
      importance: 'MAJOR',
      originLocationId: npc.locationId,
    })
  }

  return changes
}
