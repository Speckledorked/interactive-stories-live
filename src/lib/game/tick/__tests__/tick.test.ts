import { describe, it, expect } from 'vitest'
import { decideFactionTick, decideFactionGoalReassessment, explainFactionGoalReassessment, decideFactionCollapse, decideFactionFounding, decideDefection, GOAL_COMMITMENT_TURNS } from '../factionTick'
import { decideAmbitionTick, decideAmbitionOutcome, decideAgendaContinuation, buildAgendaContinuationName, MAX_AGENDA_STAGES } from '../ambitionTick'
import { NEUTRAL_BELIEF } from '../beliefTick'
import { decideRelationshipTick } from '../relationshipTick'
import { decideTerritoryClaim } from '../territory'
import { decideWarDeclaration, decideWarProgress, decideWarResolution, decideWarJoiner, explainWarMomentum } from '../warTick'
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

  // #104: belief-driven overrides only fire once an axis has drifted well
  // past neutral (50) — a faction with no beliefVector at all (undefined)
  // behaves identically to pre-#104 code.
  describe('belief-driven overrides (#104)', () => {
    const base = { resources: 50, stability: 50, military: 80, goal: 'CONSOLIDATE' as const, hasRival: false }

    it('ignores an absent beliefVector entirely, matching pre-#104 behavior', () => {
      expect(decideFactionGoalReassessment(base)).toBe(decideFactionGoalReassessment({ ...base, beliefVector: undefined }))
    })

    it('a mildly-drifted belief (below the override threshold) does not redirect the goal', () => {
      const mild = { aggression: 60, isolationism: 50, mercantilism: 50, zealotry: 50 }
      expect(decideFactionGoalReassessment({ ...base, beliefVector: mild })).toBe(decideFactionGoalReassessment(base))
    })

    it('strong isolationism forces CONSOLIDATE even with high military and no rival', () => {
      const isolationist = { aggression: 50, isolationism: 85, mercantilism: 50, zealotry: 50 }
      expect(decideFactionGoalReassessment({ ...base, beliefVector: isolationist })).toBe('CONSOLIDATE')
    })

    it('isolationism wins over a strong aggression/zealotry belief on the same faction', () => {
      const conflicted = { aggression: 90, isolationism: 90, mercantilism: 50, zealotry: 90 }
      expect(decideFactionGoalReassessment({ ...base, beliefVector: conflicted })).toBe('CONSOLIDATE')
    })

    it('strong aggression pushes EXPAND when there is no rival', () => {
      const aggressive = { aggression: 85, isolationism: 50, mercantilism: 50, zealotry: 50 }
      expect(decideFactionGoalReassessment({ ...base, beliefVector: aggressive })).toBe('EXPAND')
    })

    it('strong aggression pushes DESTABILIZE_RIVAL when a rival exists', () => {
      const aggressive = { aggression: 85, isolationism: 50, mercantilism: 50, zealotry: 50 }
      expect(decideFactionGoalReassessment({ ...base, hasRival: true, beliefVector: aggressive })).toBe('DESTABILIZE_RIVAL')
    })

    it('strong aggression does not override with LOW military — no army to push outward with', () => {
      const aggressive = { aggression: 85, isolationism: 50, mercantilism: 50, zealotry: 50 }
      expect(decideFactionGoalReassessment({ ...base, military: 20, beliefVector: aggressive })).not.toBe('EXPAND')
    })

    it('strong zealotry pushes EXPAND/DESTABILIZE_RIVAL the same way aggression does', () => {
      const zealous = { aggression: 50, isolationism: 50, mercantilism: 50, zealotry: 85 }
      expect(decideFactionGoalReassessment({ ...base, beliefVector: zealous })).toBe('EXPAND')
    })

    it('strong mercantilism pushes ENRICH even when resources are not LOW', () => {
      const mercantile = { aggression: 50, isolationism: 50, mercantilism: 85, zealotry: 50 }
      expect(decideFactionGoalReassessment({ ...base, resources: 60, beliefVector: mercantile })).toBe('ENRICH')
    })

    it('mercantilism does not override once resources are already HIGH', () => {
      const mercantile = { aggression: 50, isolationism: 50, mercantilism: 85, zealotry: 50 }
      expect(decideFactionGoalReassessment({ ...base, resources: 90, beliefVector: mercantile })).not.toBe('ENRICH')
    })

    it('stability-LOW and the goal-commitment lock both still take priority over belief', () => {
      const aggressive = { aggression: 90, isolationism: 50, mercantilism: 50, zealotry: 50 }
      expect(decideFactionGoalReassessment({ ...base, stability: 20, beliefVector: aggressive })).toBe('DEFEND')
      expect(decideFactionGoalReassessment({ ...base, goal: 'CONSOLIDATE', turnsOnCurrentGoal: 1, beliefVector: aggressive })).toBe('CONSOLIDATE')
    })
  })
})

// #94: decideFactionGoalReassessment is a thin wrapper over this — the two
// can never drift apart because there's only one implementation. These
// tests pin that agreement plus the reasoning trace's content.
describe('explainFactionGoalReassessment (#94)', () => {
  it('agrees with decideFactionGoalReassessment across every branch', () => {
    const cases = [
      { resources: 90, stability: 20, military: 90, goal: 'EXPAND' as const, hasRival: false },
      { resources: 20, stability: 60, military: 60, goal: 'CONSOLIDATE' as const, hasRival: false },
      { resources: 80, stability: 50, military: 80, goal: 'CONSOLIDATE' as const, hasRival: false },
      { resources: 80, stability: 50, military: 80, goal: 'CONSOLIDATE' as const, hasRival: true },
      { resources: 50, stability: 50, military: 50, goal: 'EXPAND' as const, hasRival: false },
      { resources: 50, stability: 50, military: 50, goal: 'CONSOLIDATE' as const, hasRival: false, turnsOnCurrentGoal: 1 },
      { resources: 50, stability: 50, military: 80, goal: 'CONSOLIDATE' as const, hasRival: false, beliefVector: { aggression: 50, isolationism: 85, mercantilism: 50, zealotry: 50 } },
    ]
    for (const faction of cases) {
      expect(explainFactionGoalReassessment(faction).goal).toBe(decideFactionGoalReassessment(faction))
    }
  })

  it('explains a DEFEND decision by naming the stability crisis', () => {
    const { reasoning } = explainFactionGoalReassessment({ resources: 90, stability: 20, military: 90, goal: 'EXPAND', hasRival: false })
    expect(reasoning.some((line) => /stability/i.test(line) && /cratered/i.test(line))).toBe(true)
  })

  it('explains a goal-commitment hold by naming the turns held and the threshold', () => {
    const { reasoning } = explainFactionGoalReassessment({ resources: 50, stability: 50, military: 50, goal: 'CONSOLIDATE', hasRival: false, turnsOnCurrentGoal: 1 })
    expect(reasoning.some((line) => line.includes('1 turn') && line.includes(String(GOAL_COMMITMENT_TURNS)))).toBe(true)
  })

  it('explains a belief override by naming the specific axis that fired', () => {
    const { reasoning } = explainFactionGoalReassessment({
      resources: 50, stability: 50, military: 80, goal: 'CONSOLIDATE', hasRival: false,
      beliefVector: { aggression: 50, isolationism: 85, mercantilism: 50, zealotry: 50 },
    })
    expect(reasoning.some((line) => /isolationism/i.test(line))).toBe(true)
  })

  it('always includes a leading line naming the raw stat bands', () => {
    const { reasoning } = explainFactionGoalReassessment({ resources: 50, stability: 50, military: 50, goal: 'CONSOLIDATE', hasRival: false })
    expect(reasoning[0]).toMatch(/stability is/i)
  })

  // #207: carrying multiple unresolved wakes was previously read by
  // nothing — a faction with recent leader deaths/absorbed collapses
  // behaved identically to one with none.
  it('overrides to DEFEND when carrying 2+ unresolved wakes, even with strong stats that would otherwise EXPAND', () => {
    const strong = { resources: 90, stability: 50, military: 90, goal: 'CONSOLIDATE' as const, hasRival: false }
    // Without a wake crisis, this strong-stats faction would EXPAND.
    expect(decideFactionGoalReassessment(strong)).toBe('EXPAND')
    expect(decideFactionGoalReassessment({ ...strong, activeWakeCount: 2 })).toBe('DEFEND')
  })

  it('does not override on a single wake — the bar is more than one', () => {
    const strong = { resources: 90, stability: 50, military: 90, goal: 'CONSOLIDATE' as const, hasRival: false }
    expect(decideFactionGoalReassessment({ ...strong, activeWakeCount: 1 })).toBe('EXPAND')
  })

  it('explains a wake-crisis DEFEND override by naming the wake count', () => {
    const { reasoning } = explainFactionGoalReassessment({ resources: 90, stability: 50, military: 90, goal: 'CONSOLIDATE', hasRival: false, activeWakeCount: 3 })
    expect(reasoning.some((line) => line.includes('3') && /wake/i.test(line))).toBe(true)
  })

  it('the wake-crisis override takes priority over the goal-commitment lock, same tier as stability-LOW', () => {
    // Freshly committed to CONSOLIDATE (0 turns held) would normally hold
    // the course per the commitment lock — but a real crisis (wakes, same
    // as stability) still redirects it.
    const result = decideFactionGoalReassessment({
      resources: 90, stability: 50, military: 90, goal: 'CONSOLIDATE', hasRival: false, turnsOnCurrentGoal: 0, activeWakeCount: 2,
    })
    expect(result).toBe('DEFEND')
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

  // #112: a smooth handoff and a chaotic collapse used to transfer
  // identically regardless of how far past the threshold stability fell.
  it('reports roughness 0 for a non-collapse', () => {
    expect(decideFactionCollapse({ stability: 50, resources: 50, military: 50 }).roughness).toBe(0)
  })

  it('reports roughness near 0 right at the crisis threshold, and 1 at zero stability', () => {
    const atThreshold = decideFactionCollapse({ stability: 10, resources: 100, military: 100 })
    const total = decideFactionCollapse({ stability: 0, resources: 100, military: 100 })
    expect(atThreshold.roughness).toBeCloseTo(0, 5)
    expect(total.roughness).toBe(1)
  })

  it('transfers strictly less the rougher the collapse, at identical resources/military', () => {
    const shallow = decideFactionCollapse({ stability: 9, resources: 100, military: 100 })
    const deep = decideFactionCollapse({ stability: 0, resources: 100, military: 100 })
    expect(deep.transferResources).toBeLessThan(shallow.transferResources)
    expect(deep.transferMilitary).toBeLessThan(shallow.transferMilitary)
  })

  // #207: a faction already carrying multiple unresolved wakes when it
  // hits the collapse threshold is plausibly mid-crisis, not a
  // coincidence — its collapse should scatter more of what's left.
  it('a wake crisis bumps roughness (and so lowers the transfer) even on an otherwise-smooth collapse', () => {
    const smooth = decideFactionCollapse({ stability: 10, resources: 100, military: 100 })
    const smoothWithWakes = decideFactionCollapse({ stability: 10, resources: 100, military: 100, activeWakeCount: 2 })
    expect(smooth.roughness).toBeCloseTo(0, 5)
    expect(smoothWithWakes.roughness).toBeCloseTo(0.25, 5)
    expect(smoothWithWakes.transferResources).toBeLessThan(smooth.transferResources)
    expect(smoothWithWakes.transferMilitary).toBeLessThan(smooth.transferMilitary)
  })

  it('does not bump roughness on a single wake — the bar is more than one', () => {
    const result = decideFactionCollapse({ stability: 10, resources: 100, military: 100, activeWakeCount: 1 })
    expect(result.roughness).toBeCloseTo(0, 5)
  })

  it('clamps the wake-crisis bump rather than pushing roughness past 1', () => {
    const total = decideFactionCollapse({ stability: 0, resources: 100, military: 100 })
    const totalWithWakes = decideFactionCollapse({ stability: 0, resources: 100, military: 100, activeWakeCount: 2 })
    expect(total.roughness).toBe(1)
    expect(totalWithWakes.roughness).toBe(1)
    expect(totalWithWakes.transferResources).toBe(total.transferResources)
  })

  it('never scatters everything even at total chaos (roughness 1)', () => {
    const result = decideFactionCollapse({ stability: 0, resources: 100, military: 100 })
    expect(result.transferResources).toBeGreaterThan(0)
    expect(result.transferMilitary).toBeGreaterThan(0)
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

  // #112: a successor founded from a total-chaos collapse should inherit
  // less than one founded from a collapse that barely tipped over the
  // threshold, at the same predecessor resources/military.
  it('inherits strictly less the rougher the collapse that spawned it', () => {
    const smooth = decideFactionFounding({ name: 'Thornburg Guild', resources: 100, military: 100, roughness: 0 })
    const chaotic = decideFactionFounding({ name: 'Thornburg Guild', resources: 100, military: 100, roughness: 1 })
    expect(chaotic.resources).toBeLessThan(smooth.resources)
    expect(chaotic.military).toBeLessThan(smooth.military)
  })

  it('defaults to roughness 0 (original flat-rate behavior) when omitted', () => {
    const withDefault = decideFactionFounding({ name: 'Thornburg Guild', resources: 100, military: 100 })
    const explicitZero = decideFactionFounding({ name: 'Thornburg Guild', resources: 100, military: 100, roughness: 0 })
    expect(withDefault.resources).toBe(explicitZero.resources)
    expect(withDefault.military).toBe(explicitZero.military)
  })

  it('never inherits nothing even at total chaos (roughness 1)', () => {
    const chaotic = decideFactionFounding({ name: 'Thornburg Guild', resources: 100, military: 100, roughness: 1 })
    expect(chaotic.resources).toBeGreaterThan(0)
    expect(chaotic.military).toBeGreaterThan(0)
  })
})

describe('decideDefection (NPC motivation model)', () => {
  it('defects an ordinary, undrifted member (neutral loyalty falls below the stay threshold)', () => {
    const result = decideDefection([{ id: 'a' }])
    expect(result.defectingIds).toEqual(['a'])
    expect(result.independentIds).toEqual([])
  })

  it('keeps a highly loyal member independent instead of defecting', () => {
    const result = decideDefection([{ id: 'a', loyalty: 85 }])
    expect(result.defectingIds).toEqual([])
    expect(result.independentIds).toEqual(['a'])
  })

  it('splits a mixed roster correctly', () => {
    const result = decideDefection([
      { id: 'loyal', loyalty: 90 },
      { id: 'ordinary' },
      { id: 'disloyal', loyalty: 10 },
    ])
    expect(result.independentIds).toEqual(['loyal'])
    expect(result.defectingIds.sort()).toEqual(['disloyal', 'ordinary'])
  })

  it('treats the threshold boundary as staying independent (>=)', () => {
    const result = decideDefection([{ id: 'a', loyalty: 70 }])
    expect(result.independentIds).toEqual(['a'])
  })

  it('handles an empty roster', () => {
    expect(decideDefection([])).toEqual({ defectingIds: [], independentIds: [] })
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

  // #108: real nearest-neighbor selection among tied candidates, when
  // adjacency data exists — falls back to alphabetical-first otherwise.
  describe('with adjacency data (#108)', () => {
    const locations = [
      { id: 'l1', name: 'Ashford', ownerFactionId: null, isContested: false },
      { id: 'l2', name: 'Briar Keep', ownerFactionId: null, isContested: false },
      { id: 'l3', name: 'Cliffhold', ownerFactionId: null, isContested: false },
    ]

    it('picks the nearest unowned candidate to home instead of the alphabetically-first one', () => {
      // home -- 1 -- Cliffhold, home -- 5 -- Ashford: Cliffhold is nearer,
      // even though Ashford would win alphabetically.
      const claim = decideTerritoryClaim(locations, claimant, [], {
        edges: [
          { locationAId: 'home', locationBId: 'l3', distance: 1 },
          { locationAId: 'home', locationBId: 'l1', distance: 5 },
        ],
        homeLocationId: 'home',
      })
      expect(claim).toEqual({ kind: 'settle', locationId: 'l3', locationName: 'Cliffhold' })
    })

    it('falls back to alphabetical-first when no candidate is reachable in the graph', () => {
      const claim = decideTerritoryClaim(locations, claimant, [], {
        edges: [{ locationAId: 'home', locationBId: 'somewhere-unrelated', distance: 1 }],
        homeLocationId: 'home',
      })
      expect(claim).toEqual({ kind: 'settle', locationId: 'l1', locationName: 'Ashford' })
    })

    it('falls back to alphabetical-first when homeLocationId is null', () => {
      const claim = decideTerritoryClaim(locations, claimant, [], {
        edges: [{ locationAId: 'l3', locationBId: 'l1', distance: 1 }],
        homeLocationId: null,
      })
      expect(claim).toEqual({ kind: 'settle', locationId: 'l1', locationName: 'Ashford' })
    })

    it('falls back to alphabetical-first when no adjacency argument is given at all', () => {
      const claim = decideTerritoryClaim(locations, claimant, [])
      expect(claim).toEqual({ kind: 'settle', locationId: 'l1', locationName: 'Ashford' })
    })
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

describe('explainWarMomentum (#94)', () => {
  it('projects the same momentum decideWarProgress would apply', () => {
    const war = { id: 'war-1', momentum: 10, startedTurn: 2 }
    const progress = decideWarProgress(war, { military: 80 }, { military: 60 }, 5)
    const explanation = explainWarMomentum(war, 'Ashcrown', 80, 'Blackreach', 60, 5)
    expect(explanation.projectedMomentum).toBe(Math.max(-100, Math.min(100, war.momentum + progress.momentumDelta)))
    expect(explanation.currentMomentum).toBe(10)
  })

  it('names the side with the military edge', () => {
    const war = { id: 'war-1', momentum: 0, startedTurn: 0 }
    const explanation = explainWarMomentum(war, 'Ashcrown', 90, 'Blackreach', 30, 1)
    expect(explanation.reasoning[0]).toContain('Ashcrown')
    expect(explanation.reasoning[0]).toMatch(/favors Ashcrown/)
  })

  it('notes an even match when both sides have equal military', () => {
    const war = { id: 'war-1', momentum: 0, startedTurn: 0 }
    const explanation = explainWarMomentum(war, 'Ashcrown', 50, 'Blackreach', 50, 1)
    expect(explanation.reasoning[0]).toMatch(/evenly matched/)
  })

  it('reports a decisive outright win once the projected momentum crosses the threshold', () => {
    const war = { id: 'war-1', momentum: 90, startedTurn: 0 }
    const explanation = explainWarMomentum(war, 'Ashcrown', 90, 'Blackreach', 10, 1)
    expect(explanation.reasoning.some((line) => /decisive threshold/.test(line) && /win outright/.test(line))).toBe(true)
  })

  it('reports a stalemate once the war has dragged past its max duration without a decisive swing', () => {
    const war = { id: 'war-1', momentum: 5, startedTurn: 0 }
    const explanation = explainWarMomentum(war, 'Ashcrown', 50, 'Blackreach', 50, 10)
    expect(explanation.reasoning.some((line) => /stalemate/.test(line))).toBe(true)
  })

  it('reports how far from decisive and how many turns remain when still inconclusive', () => {
    const war = { id: 'war-1', momentum: 5, startedTurn: 0 }
    const explanation = explainWarMomentum(war, 'Ashcrown', 51, 'Blackreach', 49, 1)
    expect(explanation.reasoning.some((line) => /short of a decisive swing/.test(line))).toBe(true)
  })
})

describe('decideWarJoiner', () => {
  it('returns null when there are no candidates', () => {
    expect(decideWarJoiner([])).toBeNull()
  })

  it('returns null when no candidate meets the military threshold', () => {
    expect(decideWarJoiner([{ id: 'f1', name: 'Weak Guild', military: 40 }])).toBeNull()
  })

  it('picks the single eligible candidate', () => {
    const candidate = { id: 'f1', name: 'Strong Guild', military: 80 }
    expect(decideWarJoiner([candidate])).toEqual(candidate)
  })

  it('picks the strongest candidate when several are eligible', () => {
    const weaker = { id: 'f1', name: 'A', military: 70 }
    const stronger = { id: 'f2', name: 'B', military: 90 }
    expect(decideWarJoiner([weaker, stronger])).toEqual(stronger)
  })

  it('breaks ties deterministically by id', () => {
    const a = { id: 'a-faction', name: 'A', military: 80 }
    const b = { id: 'b-faction', name: 'B', military: 80 }
    expect(decideWarJoiner([b, a])).toEqual(a)
    expect(decideWarJoiner([a, b])).toEqual(a)
  })

  it('ignores ineligible candidates and picks among the eligible ones', () => {
    const tooWeak = { id: 'f1', name: 'Weak', military: 50 }
    const eligible = { id: 'f2', name: 'Strong', military: 70 }
    expect(decideWarJoiner([tooWeak, eligible])).toEqual(eligible)
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

  // Depth-hardening: phase-weighted goal progress. npc-1's tempo is 3
  // ticks/phase (stableHash-derived), so turns 0-2 = observing, 3-5 =
  // preparing, 6-8 = acting, 9-11 = resting, then the cycle repeats.
  describe('phase-weighted goal progress', () => {
    it('advances slowly while observing (0.5x baseline)', () => {
      const decision = decideNpcTick(npc, 0, ['Harborview'])
      expect(decision.phase).toBe('observing')
      expect(decision.newGoalProgress).toBe(2)
    })

    it('advances at the baseline rate while preparing (1x)', () => {
      const decision = decideNpcTick(npc, 3, ['Harborview'])
      expect(decision.phase).toBe('preparing')
      expect(decision.newGoalProgress).toBe(4)
    })

    it('advances fastest while acting (2x baseline)', () => {
      const decision = decideNpcTick(npc, 6, ['Harborview'])
      expect(decision.phase).toBe('acting')
      expect(decision.newGoalProgress).toBe(8)
    })

    it('advances slowly while resting (0.5x baseline)', () => {
      const decision = decideNpcTick(npc, 9, ['Harborview'])
      expect(decision.phase).toBe('resting')
      expect(decision.newGoalProgress).toBe(2)
    })

    it('averages to the same overall pace as the old flat rate across one full cycle', () => {
      // One full cycle = 4 phases * tempo(3) ticks = 12 ticks. Sum of
      // per-tick progress across the cycle should equal 4 * 12 = 48 —
      // identical to the old flat PROGRESS_PER_TICK rate averaged over
      // the same span, even though individual ticks now vary.
      let progress = 0
      let npcState = { ...npc, goalProgress: 0 }
      for (let turn = 0; turn < 12; turn++) {
        const decision = decideNpcTick(npcState, turn, ['Harborview'])
        progress += decision.newGoalProgress - npcState.goalProgress
        npcState = { ...npcState, goalProgress: decision.newGoalProgress }
      }
      expect(progress).toBe(48)
    })

    it('never advances a goalless NPC regardless of phase', () => {
      const goalless = { ...npc, goals: null }
      for (const turn of [0, 3, 6, 9]) {
        expect(decideNpcTick(goalless, turn, ['Harborview']).newGoalProgress).toBe(0)
      }
    })
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

  // #108: "work" becomes a real graph neighbor of home when adjacency data
  // covers it — falls back to the old hash-rotation pick otherwise.
  describe('with adjacency data (#108)', () => {
    const locationNames = ['Harborview', 'Old Quarter', 'Docks']

    it('picks the real graph neighbor as "work" instead of the old hash-rotation pick', () => {
      const locationGraph = {
        idByName: new Map([
          ['Harborview', 'loc-harborview'],
          ['Old Quarter', 'loc-oldquarter'],
          ['Docks', 'loc-docks'],
        ]),
        edges: [{ locationAId: 'loc-harborview', locationBId: 'loc-docks', distance: 1 }],
      }
      // turn 0 -> morning -> "work"
      const morning = decideNpcTick(npc, 0, locationNames, null, locationGraph)
      expect(morning.nextLocation).toBe('Docks')
    })

    it('falls back to the old hash-rotation pick when adjacency data does not cover this home location', () => {
      const emptyGraph = { idByName: new Map(), edges: [] }
      const withEmptyGraph = decideNpcTick(npc, 0, locationNames, null, emptyGraph)
      const withoutGraph = decideNpcTick(npc, 0, locationNames)
      expect(withEmptyGraph.nextLocation).toBe(withoutGraph.nextLocation)
    })

    it('is unaffected by adjacency data entirely when omitted, matching pre-#108 behavior', () => {
      const a = decideNpcTick(npc, 0, locationNames)
      const b = decideNpcTick(npc, 0, locationNames)
      expect(a).toEqual(b)
    })
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

describe('decideAgendaContinuation (#104)', () => {
  const aggressive = { ...NEUTRAL_BELIEF, aggression: 80 }
  const mercantile = { ...NEUTRAL_BELIEF, mercantilism: 80 }

  it('never continues a failed ambition, regardless of belief', () => {
    expect(decideAgendaContinuation({ outcomeSuccess: false, goal: 'EXPAND', belief: aggressive, priorStageCount: 1 })).toBe(false)
  })

  it('never continues once the stage cap is reached', () => {
    expect(decideAgendaContinuation({ outcomeSuccess: true, goal: 'EXPAND', belief: aggressive, priorStageCount: MAX_AGENDA_STAGES })).toBe(false)
  })

  it('never continues with no belief on record at all', () => {
    expect(decideAgendaContinuation({ outcomeSuccess: true, goal: 'EXPAND', belief: null, priorStageCount: 1 })).toBe(false)
  })

  it('continues a successful EXPAND when aggression is elevated', () => {
    expect(decideAgendaContinuation({ outcomeSuccess: true, goal: 'EXPAND', belief: aggressive, priorStageCount: 1 })).toBe(true)
  })

  it('continues a successful DESTABILIZE_RIVAL the same way EXPAND does (both aggression-driven)', () => {
    expect(decideAgendaContinuation({ outcomeSuccess: true, goal: 'DESTABILIZE_RIVAL', belief: aggressive, priorStageCount: 1 })).toBe(true)
  })

  it('does not continue EXPAND on elevated mercantilism alone', () => {
    expect(decideAgendaContinuation({ outcomeSuccess: true, goal: 'EXPAND', belief: mercantile, priorStageCount: 1 })).toBe(false)
  })

  it('continues a successful ENRICH on elevated mercantilism, not aggression', () => {
    expect(decideAgendaContinuation({ outcomeSuccess: true, goal: 'ENRICH', belief: mercantile, priorStageCount: 1 })).toBe(true)
    expect(decideAgendaContinuation({ outcomeSuccess: true, goal: 'ENRICH', belief: aggressive, priorStageCount: 1 })).toBe(false)
  })

  it('does not continue with belief still at neutral', () => {
    expect(decideAgendaContinuation({ outcomeSuccess: true, goal: 'EXPAND', belief: NEUTRAL_BELIEF, priorStageCount: 1 })).toBe(false)
  })
})

describe('buildAgendaContinuationName (#104)', () => {
  it('is deterministic for the same inputs', () => {
    const a = buildAgendaContinuationName('Thornburg Guild', 'GENERIC', 'EXPAND', 2)
    const b = buildAgendaContinuationName('Thornburg Guild', 'GENERIC', 'EXPAND', 2)
    expect(a).toEqual(b)
  })

  it('picks a flavor from the faction archetype\'s real bounded option list', () => {
    const { flavor } = buildAgendaContinuationName('Thornburg Guild', 'CRIMINAL', 'ENRICH', 2)
    expect(['heist', 'smuggling run', 'extortion racket', 'black-market auction', 'protection racket expansion']).toContain(flavor)
  })

  it('labels stage 2 as "II" and stage 3 as "III"', () => {
    expect(buildAgendaContinuationName('Thornburg Guild', 'GENERIC', 'EXPAND', 2).name).toContain('II')
    expect(buildAgendaContinuationName('Thornburg Guild', 'GENERIC', 'EXPAND', 3).name).toContain('III')
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
