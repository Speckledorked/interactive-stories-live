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

import { prisma } from '@/lib/prisma'
import type { NPC } from '@prisma/client'
import { TickContext, TickHandlerResult, WorldChange, stableHash } from './types'

const MAJOR_IMPORTANCE_THRESHOLD = 4
const NPC_CAP = 20

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

export interface NpcTickDecision {
  phase: PlanPhase
  timeOfDay: TimeOfDay
  planPhaseChanged: boolean
  currentPlan: string
  nextLocation: string | null // null = no change
}

/** Pure decision function — no DB access, safe to unit test directly. */
export function decideNpcTick(
  npc: { id: string; goals: string | null; relationship: string | null; currentLocation: string | null },
  turnNumber: number,
  discoveredLocationNames: string[]
): NpcTickDecision {
  const timeOfDay = deriveTimeOfDay(turnNumber)
  const phaseIndex = phaseIndexAt(npc.id, turnNumber)
  const prevPhaseIndex = turnNumber > 0 ? phaseIndexAt(npc.id, turnNumber - 1) : -1
  const phase = PLAN_PHASES[phaseIndex]

  const goalText = npc.goals?.trim() || 'no clear goal'
  const relationshipNote = npc.relationship?.trim()
  const currentPlan = relationshipNote
    ? `${phase} (${timeOfDay}): ${goalText} — mindful of ${relationshipNote}`
    : `${phase} (${timeOfDay}): ${goalText}`

  let nextLocation: string | null = null
  const sorted = [...new Set(discoveredLocationNames)].sort()
  if (sorted.length >= 2) {
    const currentIdx = npc.currentLocation ? sorted.indexOf(npc.currentLocation) : -1
    const homeIdx = currentIdx !== -1 ? currentIdx : stableHash(npc.id) % sorted.length
    const workIdx = (homeIdx + 1) % sorted.length
    const isActiveHours = timeOfDay === 'morning' || timeOfDay === 'afternoon'
    const desired = sorted[isActiveHours ? workIdx : homeIdx]
    if (desired !== npc.currentLocation) {
      nextLocation = desired
    }
  }

  return {
    phase,
    timeOfDay,
    planPhaseChanged: phaseIndex !== prevPhaseIndex,
    currentPlan,
    nextLocation,
  }
}

export async function tickNpcs(ctx: TickContext): Promise<TickHandlerResult> {
  const [npcs, locations] = await Promise.all([
    prisma.nPC.findMany({
      where: { campaignId: ctx.campaignId, isAlive: true, importance: { gte: MAJOR_IMPORTANCE_THRESHOLD } },
      orderBy: { importance: 'desc' },
      take: NPC_CAP,
    }),
    prisma.location.findMany({
      where: { campaignId: ctx.campaignId, isDiscovered: true },
      select: { name: true },
    }),
  ])

  const discoveredLocationNames = locations.map((l) => l.name)
  const changes: WorldChange[] = []

  for (const npc of npcs) {
    const decision = decideNpcTick(npc, ctx.turnNumber, discoveredLocationNames)

    const updateData: { currentPlan: string; currentLocation?: string } = {
      currentPlan: decision.currentPlan,
    }
    if (decision.nextLocation) {
      updateData.currentLocation = decision.nextLocation
    }

    await prisma.nPC.update({
      where: { id: npc.id },
      data: updateData,
    })

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
    })
  }

  return changes
}
