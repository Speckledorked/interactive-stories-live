import { describe, it, expect } from 'vitest'
import { decideFactionTick, decideFactionGoalReassessment, decideFactionCollapse, decideFactionFounding } from '../factionTick'
import { decideAmbitionTick, decideAmbitionOutcome } from '../ambitionTick'
import { decideRelationshipTick } from '../relationshipTick'
import { decideTerritoryClaim } from '../territory'
import { decideWarDeclaration, decideWarProgress, decideWarResolution } from '../warTick'
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

describe('decideFactionGoalReassessment', () => {
  it('prioritizes DEFEND when stability is low, regardless of other stats', () => {
    expect(decideFactionGoalReassessment({ resources: 90, stability: 20, military: 90, goal: 'EXPAND', hasRival: false })).toBe('DEFEND')
  })

  it('prioritizes ENRICH when resources are low but stability is fine', () => {
    expect(decideFactionGoalReassessment({ resources: 20, stability: 60, military: 60, goal: 'CONSOLIDATE', hasRival: false })).toBe('ENRICH')
  })

  it('picks EXPAND when resources and military are both high, stability is not low, and there is no rival', () => {
    expect(decideFactionGoalReassessment({ resources: 80, stability: 50, military: 80, goal: 'CONSOLIDATE', hasRival: false })).toBe('EXPAND')
  })

  it('picks DESTABILIZE_RIVAL instead of EXPAND once a rival exists and military is high', () => {
    expect(decideFactionGoalReassessment({ resources: 80, stability: 50, military: 80, goal: 'CONSOLIDATE', hasRival: true })).toBe('DESTABILIZE_RIVAL')
  })

  it('does not pick DESTABILIZE_RIVAL without high military, even with a rival', () => {
    expect(decideFactionGoalReassessment({ resources: 80, stability: 50, military: 50, goal: 'CONSOLIDATE', hasRival: true })).toBe('CONSOLIDATE')
  })

  it('defaults to CONSOLIDATE otherwise', () => {
    expect(decideFactionGoalReassessment({ resources: 50, stability: 50, military: 50, goal: 'EXPAND', hasRival: false })).toBe('CONSOLIDATE')
  })

  it('is deterministic for the same input', () => {
    const faction = { resources: 50, stability: 50, military: 50, goal: 'CONSOLIDATE' as const, hasRival: false }
    expect(decideFactionGoalReassessment(faction)).toEqual(decideFactionGoalReassessment(faction))
  })
})

describe('decideFactionCollapse', () => {
  it('does not collapse above the crisis threshold', () => {
    expect(decideFactionCollapse({ stability: 15, resources: 50, military: 50 }).collapses).toBe(false)
  })

  it('collapses once stability bottoms out', () => {
    const result = decideFactionCollapse({ stability: 5, resources: 60, military: 40 })
    expect(result.collapses).toBe(true)
    expect(result.transferResources).toBeGreaterThan(0)
    expect(result.transferMilitary).toBeGreaterThan(0)
  })

  it('transfers only a fraction of resources/military, not everything', () => {
    const result = decideFactionCollapse({ stability: 0, resources: 100, military: 100 })
    expect(result.transferResources).toBeLessThan(100)
    expect(result.transferMilitary).toBeLessThan(100)
  })
})

describe('decideFactionFounding', () => {
  it('names the successor after its predecessor', () => {
    const successor = decideFactionFounding({ name: 'Thornburg Guild', resources: 50, military: 50 })
    expect(successor.name).toBe('Thornburg Guild Remnant')
  })

  it('inherits only a fraction of resources/military, not a fraction of the crisis-level stability', () => {
    const successor = decideFactionFounding({ name: 'Thornburg Guild', resources: 40, military: 40 })
    expect(successor.resources).toBeLessThan(40)
    expect(successor.military).toBeLessThan(40)
    // Stability is a fresh baseline, not derived from the parent's near-zero
    // collapse-time stability — otherwise the successor would be stillborn.
    expect(successor.stability).toBeGreaterThan(10)
  })
})

describe('decideRelationshipTick', () => {
  it('makes rivals of two factions chasing the same finite goal', () => {
    expect(decideRelationshipTick({ goal: 'EXPAND', stability: 50 }, { goal: 'EXPAND', stability: 50 })).toBe('RIVAL')
    expect(decideRelationshipTick({ goal: 'ENRICH', stability: 50 }, { goal: 'ENRICH', stability: 50 })).toBe('RIVAL')
  })

  it('makes allies of two stable, inward-looking factions', () => {
    expect(decideRelationshipTick({ goal: 'CONSOLIDATE', stability: 60 }, { goal: 'DEFEND', stability: 60 })).toBe('ALLY')
  })

  it('does not ally two inward-looking factions if either is unstable', () => {
    expect(decideRelationshipTick({ goal: 'CONSOLIDATE', stability: 20 }, { goal: 'DEFEND', stability: 60 })).toBe('NEUTRAL')
  })

  it('is neutral between factions with unrelated goals', () => {
    expect(decideRelationshipTick({ goal: 'EXPAND', stability: 50 }, { goal: 'CONSOLIDATE', stability: 50 })).toBe('NEUTRAL')
  })
})

describe('decideTerritoryClaim', () => {
  const claimant = 'iron-crown'
  const rival = 'sable-reach'

  it('settles unowned land when nothing is contested', () => {
    const claim = decideTerritoryClaim(
      [
        { id: 'l1', name: 'Ashford', ownerFactionId: null, isContested: false },
        { id: 'l2', name: 'Briar Keep', ownerFactionId: rival, isContested: false },
      ],
      claimant,
      [rival]
    )
    expect(claim).toEqual({ kind: 'settle', locationId: 'l1', locationName: 'Ashford' })
  })

  it('prefers conquering land it already contested over settling new land', () => {
    const claim = decideTerritoryClaim(
      [
        { id: 'l1', name: 'Ashford', ownerFactionId: null, isContested: false },
        { id: 'l2', name: 'Briar Keep', ownerFactionId: rival, isContested: true },
      ],
      claimant,
      [rival]
    )
    expect(claim).toEqual({ kind: 'conquer', locationId: 'l2', locationName: 'Briar Keep', fromFactionId: rival })
  })

  it('contests a rival holding when no unowned land remains — conquest takes two wins', () => {
    const claim = decideTerritoryClaim(
      [
        { id: 'l1', name: 'Ashford', ownerFactionId: claimant, isContested: false },
        { id: 'l2', name: 'Briar Keep', ownerFactionId: rival, isContested: false },
      ],
      claimant,
      [rival]
    )
    expect(claim).toEqual({ kind: 'contest', locationId: 'l2', locationName: 'Briar Keep', ownerFactionId: rival })
  })

  it('does nothing when everything is owned by itself or non-rivals', () => {
    const claim = decideTerritoryClaim(
      [
        { id: 'l1', name: 'Ashford', ownerFactionId: claimant, isContested: false },
        { id: 'l2', name: 'Briar Keep', ownerFactionId: 'neutral-third-party', isContested: false },
      ],
      claimant,
      [rival]
    )
    expect(claim).toEqual({ kind: 'none' })
  })

  it('is deterministic — sorted by name, not input order', () => {
    const locations = [
      { id: 'l2', name: 'Briar Keep', ownerFactionId: null, isContested: false },
      { id: 'l1', name: 'Ashford', ownerFactionId: null, isContested: false },
    ]
    const claim = decideTerritoryClaim(locations, claimant, [])
    expect(claim).toEqual({ kind: 'settle', locationId: 'l1', locationName: 'Ashford' })
  })
})

describe('decideWarDeclaration', () => {
  const attacker = { id: 'iron-crown', military: 80 }
  const defender = { id: 'sable-reach', military: 75 }

  it('declares war when both sides are strong and territory is already contested', () => {
    const decision = decideWarDeclaration(attacker, defender, [
      { id: 'l1', ownerFactionId: defender.id, isContested: true },
    ])
    expect(decision).toEqual({ shouldDeclare: true, contestedLocationId: 'l1' })
  })

  it('does not declare war without a contested holding, however strong both sides are', () => {
    const decision = decideWarDeclaration(attacker, defender, [
      { id: 'l1', ownerFactionId: defender.id, isContested: false },
    ])
    expect(decision.shouldDeclare).toBe(false)
  })

  it('does not declare war if either side is militarily weak', () => {
    const weakDefender = { id: 'sable-reach', military: 20 }
    const decision = decideWarDeclaration(attacker, weakDefender, [
      { id: 'l1', ownerFactionId: weakDefender.id, isContested: true },
    ])
    expect(decision.shouldDeclare).toBe(false)
  })

  it('ignores contested land the defender does not own', () => {
    const decision = decideWarDeclaration(attacker, defender, [
      { id: 'l1', ownerFactionId: 'someone-else', isContested: true },
    ])
    expect(decision.shouldDeclare).toBe(false)
  })
})

describe('decideWarProgress', () => {
  it('is deterministic for the same war+turn pair', () => {
    const war = { id: 'war-1' }
    const a = decideWarProgress(war, { military: 80 }, { military: 60 }, 5)
    const b = decideWarProgress(war, { military: 80 }, { military: 60 }, 5)
    expect(a).toEqual(b)
  })

  it('both sides pay attrition every turn regardless of momentum direction', () => {
    const progress = decideWarProgress({ id: 'war-1' }, { military: 80 }, { military: 60 }, 5)
    expect(progress.attackerResourceDelta).toBeLessThan(0)
    expect(progress.attackerMilitaryDelta).toBeLessThan(0)
    expect(progress.defenderResourceDelta).toBeLessThan(0)
    expect(progress.defenderMilitaryDelta).toBeLessThan(0)
  })

  it('momentum trends toward whichever side has more military, on average', () => {
    // Sample many turns so the deterministic variance averages out and the
    // military edge dominates.
    const deltas = Array.from({ length: 30 }, (_, i) =>
      decideWarProgress({ id: 'war-1' }, { military: 90 }, { military: 30 }, i).momentumDelta
    )
    const average = deltas.reduce((a, b) => a + b, 0) / deltas.length
    expect(average).toBeGreaterThan(0)
  })
})

describe('decideWarResolution', () => {
  it('resolves in the attacker\'s favor once momentum is decisively positive', () => {
    expect(decideWarResolution(75, 3)).toEqual({ resolves: true, outcome: 'attacker' })
  })

  it('resolves in the defender\'s favor once momentum is decisively negative', () => {
    expect(decideWarResolution(-75, 3)).toEqual({ resolves: true, outcome: 'defender' })
  })

  it('calls a stalemate once the war has dragged on long enough, regardless of momentum', () => {
    expect(decideWarResolution(10, 10)).toEqual({ resolves: true, outcome: 'stalemate' })
  })

  it('keeps escalating while momentum is inconclusive and duration is short', () => {
    expect(decideWarResolution(20, 3)).toEqual({ resolves: false, outcome: null })
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

  it('weaves an affiliated faction\'s current goal into the plan text', () => {
    const unaffiliated = decideNpcTick(npc, 5, ['Harborview'])
    const affiliated = decideNpcTick(npc, 5, ['Harborview'], { name: 'Iron Crown', goal: 'EXPAND' })
    expect(unaffiliated.currentPlan).not.toContain('Iron Crown')
    expect(affiliated.currentPlan).toContain('Iron Crown')
    expect(affiliated.currentPlan).toContain('EXPAND')
  })
})

describe('decideAmbitionTick', () => {
  const base = { name: 'Thornburg Guild', archetype: 'GENERIC' as const, resources: 80, hasActiveSpawnedClock: false }

  it('spawns a tournament clock for a high-resource ENRICH faction', () => {
    const decision = decideAmbitionTick({ ...base, goal: 'ENRICH' })
    expect(decision.shouldSpawn).toBe(true)
    expect(decision.fallbackName).toBe('Thornburg Guild Tournament')
    expect(decision.resourceCost).toBeGreaterThan(0)
  })

  it('spawns a campaign clock for a high-resource EXPAND faction', () => {
    const decision = decideAmbitionTick({ ...base, goal: 'EXPAND' })
    expect(decision.shouldSpawn).toBe(true)
    expect(decision.fallbackName).toBe('Thornburg Guild Military Campaign')
    expect(decision.resourceCost).toBeGreaterThan(0)
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
  })

  it('spawns a sabotage-flavored ambition for a high-resource DESTABILIZE_RIVAL faction', () => {
    const decision = decideAmbitionTick({ ...base, goal: 'DESTABILIZE_RIVAL' })
    expect(decision.shouldSpawn).toBe(true)
    expect(decision.fallbackName).toBe('Thornburg Guild Sabotage Campaign')
    expect(decision.resourceCost).toBeGreaterThan(0)
  })

  it('picks a different flavor pool for a different archetype pursuing the same goal', () => {
    const guild = decideAmbitionTick({ ...base, goal: 'ENRICH' })
    const secretSociety = decideAmbitionTick({ ...base, archetype: 'SECRET_SOCIETY', goal: 'ENRICH' })
    const political = decideAmbitionTick({ ...base, archetype: 'POLITICAL', goal: 'ENRICH' })
    expect(guild.fallbackName).toBe('Thornburg Guild Tournament')
    expect(secretSociety.fallbackName).toBe('Thornburg Guild Black-Market Venture')
    expect(political.fallbackName).toBe('Thornburg Guild Fundraising Gala')
    // Mechanical pacing (category/maxTicks) stays goal-driven, not archetype-driven.
    expect(guild.category).toBe(secretSociety.category)
    expect(guild.maxTicks).toBe(secretSociety.maxTicks)
  })
})

describe('decideAmbitionOutcome', () => {
  const input = { factionId: 'faction-1', clockId: 'clock-1', factionName: 'Thornburg Guild', goal: 'ENRICH' as const, resources: 80, military: 50 }

  it('is deterministic for the same faction+clock pair', () => {
    expect(decideAmbitionOutcome(input)).toEqual(decideAmbitionOutcome(input))
  })

  it('produces exactly one of the two known ENRICH outcome shapes', () => {
    const outcome = decideAmbitionOutcome(input)
    if (outcome.success) {
      expect(outcome).toEqual({ success: true, resourceDelta: 10, stabilityDelta: 2, militaryDelta: 0, threatLevelDelta: 1, targetStabilityDelta: 0, targetResourceDelta: 0, consequenceText: `${input.factionName} comes out ahead, and its coffers and reputation grow.` })
    } else {
      expect(outcome).toEqual({ success: false, resourceDelta: -6, stabilityDelta: -3, militaryDelta: 0, threatLevelDelta: 0, targetStabilityDelta: 0, targetResourceDelta: 0, consequenceText: `${input.factionName}'s effort falls flat, and the setback dents its standing.` })
    }
  })

  it('produces exactly one of the two known EXPAND outcome shapes', () => {
    const outcome = decideAmbitionOutcome({ ...input, goal: 'EXPAND' })
    if (outcome.success) {
      expect(outcome).toEqual({ success: true, resourceDelta: 0, stabilityDelta: -2, militaryDelta: 6, threatLevelDelta: 1, targetStabilityDelta: 0, targetResourceDelta: 0, consequenceText: `${input.factionName} claims new ground, reshaping the region's balance of power.` })
    } else {
      expect(outcome).toEqual({ success: false, resourceDelta: -8, stabilityDelta: -4, militaryDelta: -3, threatLevelDelta: 0, targetStabilityDelta: 0, targetResourceDelta: 0, consequenceText: `${input.factionName} overextends and is thrown back, its ambitions costing more than they gained.` })
    }
  })

  it('produces exactly one of the two known DESTABILIZE_RIVAL outcome shapes, naming the target when given', () => {
    const outcome = decideAmbitionOutcome({ ...input, goal: 'DESTABILIZE_RIVAL', targetFactionName: 'Sable Reach' })
    if (outcome.success) {
      expect(outcome).toEqual({ success: true, resourceDelta: -3, stabilityDelta: 1, militaryDelta: 2, threatLevelDelta: 1, targetStabilityDelta: -4, targetResourceDelta: -3, consequenceText: `${input.factionName} deals a blow to Sable Reach's standing, and returns stronger for the effort.` })
    } else {
      expect(outcome).toEqual({ success: false, resourceDelta: -5, stabilityDelta: -3, militaryDelta: -4, threatLevelDelta: 0, targetStabilityDelta: 0, targetResourceDelta: 0, consequenceText: `${input.factionName}'s scheme against Sable Reach unravels, costing it dearly.` })
    }
  })

  it('falls back to generic phrasing when no target is on record', () => {
    const outcome = decideAmbitionOutcome({ ...input, goal: 'DESTABILIZE_RIVAL' })
    expect(outcome.consequenceText).toContain('its rival')
  })

  it('never damages the target on a failed DESTABILIZE_RIVAL attempt', () => {
    // Sweep clock ids to find both a success and a failure deterministically,
    // and confirm target deltas are only ever nonzero on the success branch.
    const outcomes = Array.from({ length: 20 }, (_, i) =>
      decideAmbitionOutcome({ ...input, goal: 'DESTABILIZE_RIVAL', targetFactionName: 'Sable Reach', clockId: `clock-${i}` })
    )
    for (const outcome of outcomes) {
      if (!outcome.success) {
        expect(outcome.targetStabilityDelta).toBe(0)
        expect(outcome.targetResourceDelta).toBe(0)
      } else {
        expect(outcome.targetStabilityDelta).toBeLessThan(0)
        expect(outcome.targetResourceDelta).toBeLessThan(0)
      }
    }
  })

  it('never guarantees success even at a maxed-out relevant stat', () => {
    // 50 different clock ids give a spread of deterministic rolls; with the
    // relevant stat maxed the success chance caps at 90%, so across 50
    // samples both outcomes should appear — proves it isn't a rubber stamp.
    const outcomes = Array.from({ length: 50 }, (_, i) =>
      decideAmbitionOutcome({ ...input, resources: 100, clockId: `clock-${i}` })
    )
    const successCount = outcomes.filter((o) => o.success).length
    expect(successCount).toBeGreaterThan(0)
    expect(successCount).toBeLessThan(50)
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
