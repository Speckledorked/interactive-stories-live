// src/lib/game/tick/__tests__/simDepthWiring2.test.ts
// The second depth-wiring sweep: wars pin rivalries, threat deters,
// leader ambition and defaulted debt gate war declarations, battlefield
// ruin and cut supply lines bleed armies, ghost towns extract nothing,
// and beliefs drive diplomacy. All pure-function level — deterministic,
// no DB, no AI.
import { describe, it, expect } from 'vitest'
import { decideRelationshipTick, BELIEF_RIVALRY_DISTANCE } from '../relationshipTick'
import { decideWarDeclaration, decideWarProgress } from '../warTick'
import { decideExtraction, hasWorkingRoute } from '../logisticsTick'

describe('war pins rivalries (decideRelationshipTick)', () => {
  it('pins RIVAL for a war pair even when goals would say NEUTRAL', () => {
    const d = decideRelationshipTick(
      { goal: 'EXPAND', stability: 50 },
      { goal: 'CONSOLIDATE', stability: 50 },
      { atWar: true }
    )
    expect(d).toEqual({ type: 'RIVAL', pin: 'war' })
  })

  it('pins RIVAL for a war pair even when goals would say ALLY', () => {
    const d = decideRelationshipTick(
      { goal: 'DEFEND', stability: 80 },
      { goal: 'CONSOLIDATE', stability: 80 },
      { atWar: true }
    )
    expect(d.type).toBe('RIVAL')
    expect(d.pin).toBe('war')
  })

  it('keeps legacy behavior without the war pin', () => {
    expect(
      decideRelationshipTick({ goal: 'EXPAND', stability: 50 }, { goal: 'CONSOLIDATE', stability: 50 }).type
    ).toBe('NEUTRAL')
    expect(
      decideRelationshipTick({ goal: 'EXPAND', stability: 50 }, { goal: 'EXPAND', stability: 50 }).type
    ).toBe('RIVAL')
  })
})

describe('beliefs drive diplomacy (decideRelationshipTick)', () => {
  const neutral = { aggression: 50, isolationism: 50, mercantilism: 50, zealotry: 50 }

  it('makes RIVALs of factions far apart on one belief axis', () => {
    const d = decideRelationshipTick(
      { goal: 'DEFEND', stability: 80 },
      { goal: 'DEFEND', stability: 80 },
      { beliefA: neutral, beliefB: { ...neutral, aggression: 95 } }
    )
    expect(d).toEqual({ type: 'RIVAL', pin: 'belief' })
  })

  it('stays out of it below the threshold', () => {
    const d = decideRelationshipTick(
      { goal: 'DEFEND', stability: 80 },
      { goal: 'DEFEND', stability: 80 },
      { beliefA: neutral, beliefB: { ...neutral, aggression: 50 + BELIEF_RIVALRY_DISTANCE - 1 } }
    )
    expect(d.type).toBe('ALLY')
    expect(d.pin).toBeUndefined()
  })

  it('ignores null beliefs (never drifted) — legacy behavior', () => {
    const d = decideRelationshipTick(
      { goal: 'DEFEND', stability: 80 },
      { goal: 'DEFEND', stability: 80 },
      { beliefA: null, beliefB: { ...neutral, aggression: 95 } }
    )
    expect(d.type).toBe('ALLY')
  })

  it('war pin wins over belief pin when both apply', () => {
    const d = decideRelationshipTick(
      { goal: 'DEFEND', stability: 80 },
      { goal: 'DEFEND', stability: 80 },
      { atWar: true, beliefA: neutral, beliefB: { ...neutral, zealotry: 100 } }
    )
    expect(d.pin).toBe('war')
  })
})

describe('threat deters war declarations (decideWarDeclaration)', () => {
  const attacker = { id: 'att', military: 80 }
  const locations = [{ id: 'prize', ownerFactionId: 'def', isContested: true }]

  it('blocks declaration against a threat 4 defender', () => {
    const d = decideWarDeclaration(attacker, { id: 'def', military: 80, threatLevel: 4 }, locations)
    expect(d.shouldDeclare).toBe(false)
    expect(d.threatDeterrence).toBe(true)
  })

  it('blocks declaration against a threat 5 defender', () => {
    const d = decideWarDeclaration(attacker, { id: 'def', military: 80, threatLevel: 5 }, locations)
    expect(d.shouldDeclare).toBe(false)
    expect(d.threatDeterrence).toBe(true)
  })

  it('blocks declaration against a threat 3 defender', () => {
    const d = decideWarDeclaration(attacker, { id: 'def', military: 80, threatLevel: 3 }, locations)
    expect(d.shouldDeclare).toBe(false)
    expect(d.threatDeterrence).toBe(true)
  })

  it('declares against a threat 2 defender', () => {
    const d = decideWarDeclaration(attacker, { id: 'def', military: 80, threatLevel: 2 }, locations)
    expect(d.shouldDeclare).toBe(true)
    expect(d.threatDeterrence).toBeUndefined()
  })

  it('keeps legacy behavior when threat is unknown', () => {
    const d = decideWarDeclaration(attacker, { id: 'def', military: 80 }, locations)
    expect(d.shouldDeclare).toBe(true)
  })
})

describe('leader ambition gates war declarations (decideWarDeclaration)', () => {
  const defender = { id: 'def', military: 80 }
  const locations = [{ id: 'prize', ownerFactionId: 'def', isContested: true }]

  it('blocks declaration under a dovish leader (ambition below 34)', () => {
    const d = decideWarDeclaration({ id: 'att', military: 80, leaderAmbition: 20 }, defender, locations)
    expect(d.shouldDeclare).toBe(false)
    expect(d.dovishLeader).toBe(true)
  })

  it('declares under an ambitious leader', () => {
    const d = decideWarDeclaration({ id: 'att', military: 80, leaderAmbition: 70 }, defender, locations)
    expect(d.shouldDeclare).toBe(true)
    expect(d.dovishLeader).toBeUndefined()
  })

  it('keeps legacy behavior with no NPC leader (undefined ambition)', () => {
    const d = decideWarDeclaration({ id: 'att', military: 80 }, defender, locations)
    expect(d.shouldDeclare).toBe(true)
  })
})

describe('defaulted debt blocks war declarations (decideWarDeclaration)', () => {
  const defender = { id: 'def', military: 80 }
  const locations = [{ id: 'prize', ownerFactionId: 'def', isContested: true }]

  it('blocks declaration when the attacker defaulted 15 turns ago', () => {
    const d = decideWarDeclaration({ id: 'att', military: 80, defaultedTurnsAgo: 15 }, defender, locations)
    expect(d.shouldDeclare).toBe(false)
    expect(d.defaultedDebt).toBe(true)
  })

  it('blocks declaration when the attacker defaulted this turn', () => {
    const d = decideWarDeclaration({ id: 'att', military: 80, defaultedTurnsAgo: 0 }, defender, locations)
    expect(d.shouldDeclare).toBe(false)
    expect(d.defaultedDebt).toBe(true)
  })

  it('declares once the default is 16 turns old — stale defaults are forgiven', () => {
    const d = decideWarDeclaration({ id: 'att', military: 80, defaultedTurnsAgo: 16 }, defender, locations)
    expect(d.shouldDeclare).toBe(true)
    expect(d.defaultedDebt).toBeUndefined()
  })

  it('declares when no default is on record (undefined keeps the old no-block behavior)', () => {
    const d = decideWarDeclaration({ id: 'att', military: 80 }, defender, locations)
    expect(d.shouldDeclare).toBe(true)
    expect(d.defaultedDebt).toBeUndefined()
  })
})

describe('battlefield ruin bleeds armies (decideWarProgress)', () => {
  const war = { id: 'war-1' }

  it('adds symmetric +2 military attrition on ruined ground (condition < 25)', () => {
    const d = decideWarProgress(war, { military: 80 }, { military: 80 }, 5, undefined, 10)
    expect(d.attackerMilitaryDelta).toBe(-4)
    expect(d.defenderMilitaryDelta).toBe(-4)
    expect(d.attackerResourceDelta).toBe(-3)
  })

  it('does not penalize ground at exactly the threshold', () => {
    const d = decideWarProgress(war, { military: 80 }, { military: 80 }, 5, undefined, 25)
    expect(d.attackerMilitaryDelta).toBe(-2)
    expect(d.defenderMilitaryDelta).toBe(-2)
  })

  it('keeps legacy behavior without a condition reading', () => {
    const d = decideWarProgress(war, { military: 80 }, { military: 80 }, 5)
    expect(d.attackerMilitaryDelta).toBe(-2)
    expect(d.defenderMilitaryDelta).toBe(-2)
  })

  it('stacks with severe weather (ruin + storm = -5 each side)', () => {
    const d = decideWarProgress(war, { military: 80 }, { military: 80 }, 5, { condition: 'STORM', severity: 5 }, 10)
    expect(d.attackerMilitaryDelta).toBe(-5)
    expect(d.defenderMilitaryDelta).toBe(-5)
  })
})

describe('cut supply lines bleed the attacker (decideWarProgress)', () => {
  const war = { id: 'war-1' }

  it('adds attacker-side attrition when the supply route is cut', () => {
    const d = decideWarProgress(war, { military: 80 }, { military: 80 }, 5, undefined, undefined, true)
    expect(d.attackerMilitaryDelta).toBe(-3)
    expect(d.defenderMilitaryDelta).toBe(-2)
  })

  it('keeps legacy behavior when supply holds (or is unknown)', () => {
    const cut = decideWarProgress(war, { military: 80 }, { military: 80 }, 5, undefined, undefined, false)
    expect(cut.attackerMilitaryDelta).toBe(-2)
    const unknown = decideWarProgress(war, { military: 80 }, { military: 80 }, 5)
    expect(unknown.attackerMilitaryDelta).toBe(-2)
  })

  it('stacks with ruin: cut supply on ruined ground hits the attacker for -5', () => {
    const d = decideWarProgress(war, { military: 80 }, { military: 80 }, 5, undefined, 10, true)
    expect(d.attackerMilitaryDelta).toBe(-5)
    expect(d.defenderMilitaryDelta).toBe(-4)
  })
})

describe('hasWorkingRoute is consumable by warTick (exported predicate)', () => {
  const routes = [{ fromLocationId: 'front', toLocationId: 'depot', isBlockaded: false }]
  const owners = new Map([
    ['front', 'attacker'],
    ['depot', 'attacker'],
  ])

  it('finds the attacker-supplied front connected', () => {
    expect(hasWorkingRoute('front', 'attacker', routes, owners, 2)).toBe(true)
  })

  it('reports cut when no route touches the front', () => {
    expect(hasWorkingRoute('front', 'attacker', [], owners, 2)).toBe(false)
  })

  it('reports cut when the only route is blockaded', () => {
    const blockaded = [{ fromLocationId: 'front', toLocationId: 'depot', isBlockaded: true }]
    expect(hasWorkingRoute('front', 'attacker', blockaded, owners, 2)).toBe(false)
  })

  it('strictForeignFront: a lone home location does not supply a foreign front', () => {
    const loneOwners = new Map([
      ['front', 'defender'],
      ['home', 'attacker'],
    ])
    expect(hasWorkingRoute('front', 'attacker', [], loneOwners, 1, new Map(), { strictForeignFront: true })).toBe(false)
  })

  it('strictForeignFront: a lone home location still supplies its own ground', () => {
    const homeOwners = new Map([['home', 'attacker']])
    expect(hasWorkingRoute('home', 'attacker', [], homeOwners, 1, new Map(), { strictForeignFront: true })).toBe(true)
  })

  it('without the strict flag the lone-location shortcut is unchanged (extraction semantics)', () => {
    const loneOwners = new Map([
      ['front', 'defender'],
      ['home', 'attacker'],
    ])
    expect(hasWorkingRoute('front', 'attacker', [], loneOwners, 1)).toBe(true)
  })
})

describe('ghost towns extract nothing (decideExtraction)', () => {
  const routes: never[] = []

  it('yields nothing for a tracked zero-population location', () => {
    const result = decideExtraction(
      [{ locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1', population: 0 }],
      routes
    )
    expect(result).toEqual([])
  })

  it('yields normally for a populated location', () => {
    const result = decideExtraction(
      [{ locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1', population: 120 }],
      routes
    )
    expect(result).toEqual([{ locationId: 'loc1', factionId: 'f1', resourceGain: 2 }])
  })

  it('keeps legacy behavior for untracked (null) population', () => {
    const result = decideExtraction(
      [{ locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1', population: null }],
      routes
    )
    expect(result).toEqual([{ locationId: 'loc1', factionId: 'f1', resourceGain: 2 }])
  })

  it('keeps legacy behavior when population is absent', () => {
    const result = decideExtraction([{ locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' }], routes)
    expect(result).toEqual([{ locationId: 'loc1', factionId: 'f1', resourceGain: 2 }])
  })
})
