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
import { rosterNpcFilter } from './capOrdering'

// Exported so other systems that touch NPC.importance (e.g. consequence-driven
// escalation in src/lib/game/consequences.ts) use the exact same cutoff for
// "major" rather than redefining it.
export const MAJOR_IMPORTANCE_THRESHOLD = 4

const TIME_OF_DAY = ['morning', 'afternoon', 'evening', 'night'] as const
type TimeOfDay = (typeof TIME_OF_DAY)[number]

const PLAN_PHASES = ['observing', 'preparing', 'acting', 'resting'] as const
type PlanPhase = (typeof PLAN_PHASES)[number]

export function deriveTimeOfDay(turnNumber: number): TimeOfDay {
  return TIME_OF_DAY[((turnNumber % TIME_OF_DAY.length) + TIME_OF_DAY.length) % TIME_OF_DAY.length]
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
 * identically to before. */
export interface NpcLocationGraph {
  idByName: Map<string, string>
  edges: AdjacencyEdge[]
}

/** Pure decision function — no DB access, safe to unit test directly. */
export function decideNpcTick(
  npc: { id: string; goals: string | null; relationship: string | null; currentLocation: string | null; goalProgress: number },
  turnNumber: number,
  discoveredLocationNames: string[],
  // World Sim Phase 4: an affiliated major NPC's plan reflects their
  // faction's current strategic posture, so "serving Iron Crown" reads
  // differently while that faction is pursuing EXPAND vs. DEFEND — the
  // affiliation isn't just a foreign key, it colors the NPC's own flavor text.
  faction: { name: string; goal: string } | null = null,
  locationGraph?: NpcLocationGraph
): NpcTickDecision {
  const timeOfDay = deriveTimeOfDay(turnNumber)
  const phaseIndex = phaseIndexAt(npc.id, turnNumber)
  const prevPhaseIndex = turnNumber > 0 ? phaseIndexAt(npc.id, turnNumber - 1) : -1
  const phase = PLAN_PHASES[phaseIndex]

  const goalText = npc.goals?.trim() || 'no clear goal'
  const relationshipNote = npc.relationship?.trim()
  const factionNote = faction ? ` [${faction.name}, pursuing ${faction.goal}]` : ''
  const currentPlan = relationshipNote
    ? `${phase} (${timeOfDay}): ${goalText} — mindful of ${relationshipNote}${factionNote}`
    : `${phase} (${timeOfDay}): ${goalText}${factionNote}`

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
        .filter((name): name is string => !!name && name !== homeName)
      if (neighborNames.length > 0) {
        const sortedNeighbors = [...new Set(neighborNames)].sort()
        workName = sortedNeighbors[stableHash(`${npc.id}:work`) % sortedNeighbors.length]
      }
    }
    // Fallback: the exact pre-#108 hash-rotation pick, unchanged, used
    // whenever adjacency data doesn't cover this home location at all.
    if (!workName) {
      workName = sorted[(homeIdx + 1) % sorted.length]
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
  const rawProgress = hasGoal ? npc.goalProgress + PROGRESS_PER_TICK * PHASE_PROGRESS_WEIGHT[phase] : npc.goalProgress
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
  const [npcs, locations, adjacencyRows] = await Promise.all([
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
      select: { id: true, name: true },
    }),
    // #108: optional input to decideNpcTick's "work" pick — falls back to
    // the pre-#108 hash rotation when this is empty or doesn't cover a
    // given home location.
    ctx.db.locationAdjacency.findMany({
      where: { campaignId: ctx.campaignId },
      select: { locationAId: true, locationBId: true, distance: true },
    }),
  ])

  const discoveredLocationNames = locations.map((l) => l.name)
  // The tick only ever moves an NPC to a name drawn from this same
  // `locations` fetch, so the id is always known here — keeps
  // NPC.locationId in sync with currentLocation the moment the tick moves
  // someone, the same as the AI write-back path does for PCs (see
  // README Known Bugs P1 — Location stored as free text, not an FK).
  const locationIdByName = new Map(locations.map((l) => [l.name, l.id]))
  const locationGraph = { idByName: locationIdByName, edges: adjacencyRows as AdjacencyEdge[] }
  const changes: WorldChange[] = []

  for (const npc of npcs) {
    const factionContext = npc.faction?.isActive ? { name: npc.faction.name, goal: npc.faction.goal } : null
    const decision = decideNpcTick(npc, ctx.turnNumber, discoveredLocationNames, factionContext, locationGraph)

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
