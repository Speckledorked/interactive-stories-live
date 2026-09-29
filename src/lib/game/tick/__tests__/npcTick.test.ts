import { describe, it, expect } from 'vitest'

import { decideNpcTick, type NpcLocationGraph } from '../npcTick'
import { simTurn } from '@/lib/game/turnClock'

const NPC = { id: 'npc-war', goals: 'Rebuild the granary', relationship: null, currentLocation: 'War Town', goalProgress: 0 }
const NAMES = ['Home', 'War Town']
// 8 in-fiction hours = morning, the active-hours commute window.
const MORNING_HOURS = 8

function graph(warZoneIds: string[] = [], contestedIds: string[] = [], edges: NpcLocationGraph['edges'] = []): NpcLocationGraph {
  return {
    idByName: new Map([
      ['Home', 'loc-home'],
      ['War Town', 'loc-war'],
    ]),
    edges,
    contestedIds: new Set(contestedIds),
    warZoneIds: new Set(warZoneIds),
  }
}

describe('decideNpcTick — war-zone slowdown', () => {
  it('halves goal progress at a location owned by an active-war participant', () => {
    const turn = simTurn(12)
    const full = decideNpcTick(NPC, turn, NAMES, null, graph(), MORNING_HOURS)
    const slowed = decideNpcTick(NPC, turn, NAMES, null, graph(['loc-war']), MORNING_HOURS)
    expect(slowed.newGoalProgress).toBeGreaterThan(0)
    expect(slowed.newGoalProgress - NPC.goalProgress).toBe((full.newGoalProgress - NPC.goalProgress) * 0.5)
  })

  it('a location owned by no war participant keeps full progress', () => {
    const turn = simTurn(12)
    const full = decideNpcTick(NPC, turn, NAMES, null, graph(), MORNING_HOURS)
    const unaffected = decideNpcTick(NPC, turn, NAMES, null, graph(['loc-home']), MORNING_HOURS)
    expect(unaffected.newGoalProgress).toBe(full.newGoalProgress)
  })

  it('contested ground still slows progress, unchanged', () => {
    const turn = simTurn(12)
    const full = decideNpcTick(NPC, turn, NAMES, null, graph(), MORNING_HOURS)
    const slowed = decideNpcTick(NPC, turn, NAMES, null, graph([], ['loc-war']), MORNING_HOURS)
    expect(slowed.newGoalProgress - NPC.goalProgress).toBe((full.newGoalProgress - NPC.goalProgress) * 0.5)
  })

  it('war-zone ground does not change work-destination avoidance — only contestedIds does', () => {
    const homeNpc = { ...NPC, currentLocation: 'Home' }
    const turn = simTurn(12)
    const edges = [{ locationAId: 'loc-home', locationBId: 'loc-war', distance: 1 }]

    // War-zone but not contested: the NPC still commutes there for work.
    const warZoneOnly = decideNpcTick(homeNpc, turn, NAMES, null, graph(['loc-war'], [], edges), MORNING_HOURS)
    expect(warZoneOnly.nextLocation).toBe('War Town')

    // Contested: the work pick steps over it, even with warZoneIds also set.
    const contested = decideNpcTick(homeNpc, turn, NAMES, null, graph(['loc-war'], ['loc-war'], edges), MORNING_HOURS)
    expect(contested.nextLocation).toBeNull()
  })
})
