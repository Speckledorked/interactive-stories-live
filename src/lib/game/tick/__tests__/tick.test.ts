import { describe, it, expect } from 'vitest'
import { decideFactionTick } from '../factionTick'
import { decideAmbitionTick } from '../ambitionTick'
import { decideNpcTick, deriveTimeOfDay } from '../npcTick'
import { decideNextWeather } from '../weatherTick'

describe('decideFactionTick', () => {
  it('is deterministic for the same input', () => {
    const faction = { resources: 50, stability: 50, military: 50, goal: 'EXPAND' as const }
    expect(decideFactionTick(faction)).toEqual(decideFactionTick(faction))
  })

  it('applies goal-specific deltas, not random ones', () => {
    const base = { resources: 50, stability: 50, military: 50 }
    expect(decideFactionTick({ ...base, goal: 'EXPAND' })).toEqual({ resources: 47, stability: 49, military: 52 })
    expect(decideFactionTick({ ...base, goal: 'ENRICH' })).toEqual({ resources: 54, stability: 51, military: 49 })
    expect(decideFactionTick({ ...base, goal: 'CONSOLIDATE' })).toEqual({ resources: 51, stability: 52, military: 50 })
  })

  it('clamps values to the 0-100 range', () => {
    const result = decideFactionTick({ resources: 1, stability: 1, military: 99, goal: 'DESTABILIZE_RIVAL' })
    expect(result.resources).toBe(0)
    expect(result.stability).toBe(0)
    expect(result.military).toBe(100)
  })
})

describe('decideNpcTick', () => {
  const npc = { id: 'npc-1', goals: 'find the artifact', relationship: null, currentLocation: 'Harborview', goalProgress: 0 }

  it('is deterministic for the same turn number', () => {
    const a = decideNpcTick(npc, 5, ['Harborview', 'Old Quarter'])
    const b = decideNpcTick(npc, 5, ['Harborview', 'Old Quarter'])
    expect(a).toEqual(b)
  })

  it('stays put when fewer than 2 discovered locations exist', () => {
    const decision = decideNpcTick(npc, 5, ['Harborview'])
    expect(decision.nextLocation).toBeNull()
  })

  it('commutes between two locations across the day/night cycle', () => {
    // morning/afternoon => "work", evening/night => "home"
    const morning = decideNpcTick(npc, 0, ['Harborview', 'Old Quarter']) // turnNumber % 4 === 0 -> morning
    const night = decideNpcTick(npc, 3, ['Harborview', 'Old Quarter']) // turnNumber % 4 === 3 -> night
    expect(deriveTimeOfDay(0)).toBe('morning')
    expect(deriveTimeOfDay(3)).toBe('night')
    expect(morning.nextLocation).not.toBe(night.nextLocation ?? npc.currentLocation)
  })

  it('advances goal progress deterministically while a goal is set', () => {
    const decision = decideNpcTick(npc, 5, ['Harborview'])
    expect(decision.newGoalProgress).toBe(4)
    expect(decision.goalCompleted).toBe(false)
  })

  it('does not advance progress for a goalless NPC', () => {
    const goalless = { ...npc, goals: null }
    const decision = decideNpcTick(goalless, 5, ['Harborview'])
    expect(decision.newGoalProgress).toBe(0)
    expect(decision.goalCompleted).toBe(false)
  })

  it('completes the goal and resets progress once it crosses 100', () => {
    const almostDone = { ...npc, goalProgress: 98 }
    const decision = decideNpcTick(almostDone, 5, ['Harborview'])
    expect(decision.goalCompleted).toBe(true)
    expect(decision.newGoalProgress).toBe(0)
  })
})

describe('decideAmbitionTick', () => {
  const base = { name: 'Thornburg Guild', resources: 80, hasActiveSpawnedClock: false }

  it('spawns a tournament clock for a high-resource ENRICH faction', () => {
    const decision = decideAmbitionTick({ ...base, goal: 'ENRICH' })
    expect(decision.shouldSpawn).toBe(true)
    expect(decision.fallbackName).toBe('Thornburg Guild Grand Tournament')
  })

  it('spawns a campaign clock for a high-resource EXPAND faction', () => {
    const decision = decideAmbitionTick({ ...base, goal: 'EXPAND' })
    expect(decision.shouldSpawn).toBe(true)
    expect(decision.fallbackName).toBe('Thornburg Guild Territorial Campaign')
  })

  it('does not spawn below the resource threshold', () => {
    const decision = decideAmbitionTick({ ...base, goal: 'ENRICH', resources: 40 })
    expect(decision.shouldSpawn).toBe(false)
  })

  it('does not spawn a second clock while one is already active', () => {
    const decision = decideAmbitionTick({ ...base, goal: 'ENRICH', hasActiveSpawnedClock: true })
    expect(decision.shouldSpawn).toBe(false)
  })

  it('does not spawn for inward-facing goals', () => {
    expect(decideAmbitionTick({ ...base, goal: 'DEFEND' }).shouldSpawn).toBe(false)
    expect(decideAmbitionTick({ ...base, goal: 'CONSOLIDATE' }).shouldSpawn).toBe(false)
    expect(decideAmbitionTick({ ...base, goal: 'DESTABILIZE_RIVAL' }).shouldSpawn).toBe(false)
  })
})

describe('decideNextWeather', () => {
  it('is deterministic for the same location and turn number', () => {
    const a = decideNextWeather('loc-1', 10, 'CLEAR', 2)
    const b = decideNextWeather('loc-1', 10, 'CLEAR', 2)
    expect(a).toEqual(b)
  })

  it('only transitions to conditions reachable from the current one', () => {
    const result = decideNextWeather('loc-1', 42, 'CLEAR', 1)
    expect(['CLEAR', 'CLOUDY']).toContain(result.nextCondition)
  })

  it('clamps severity to 1-5', () => {
    const low = decideNextWeather('loc-1', 1, 'CLEAR', 1)
    const high = decideNextWeather('loc-1', 1, 'CLEAR', 5)
    expect(low.nextSeverity).toBeGreaterThanOrEqual(1)
    expect(high.nextSeverity).toBeLessThanOrEqual(5)
  })
})
