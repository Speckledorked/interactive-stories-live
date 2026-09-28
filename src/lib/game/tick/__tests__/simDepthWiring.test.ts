// src/lib/game/tick/__tests__/simDepthWiring.test.ts
// The seven dead-code wirings: weather has mechanical consumers, season
// touches location condition, rumors re-enter the sim (migration flight +
// disposition hearsay), population is load-bearing (manpower) and
// flight events feed faction stability, ambitions respect the leader's
// ambition, and influence gates war declarations. All pure-function
// level — deterministic, no DB, no AI.
import { describe, it, expect } from 'vitest'
import { isSevereWeather } from '../weatherTick'
import { decideWarProgress, decideWarDeclaration } from '../warTick'
import { decideMigration, weatherPenalty } from '../migrationTick'
import { decideExtraction } from '../logisticsTick'
import { decideConditionDrift, SEASON_CONDITION_MODIFIER } from '../locationConditionTick'
import { decideDispositionDrift } from '../npcDispositionTick'
import { decideFactionTick } from '../factionTick'
import { decideAmbitionTick } from '../ambitionTick'

describe('isSevereWeather (shared weather predicate)', () => {
  it('treats STORM/SNOW at severity 4+ as severe', () => {
    expect(isSevereWeather('STORM', 4)).toBe(true)
    expect(isSevereWeather('STORM', 5)).toBe(true)
    expect(isSevereWeather('SNOW', 4)).toBe(true)
  })

  it('treats lesser weather as set dressing, not mechanics', () => {
    expect(isSevereWeather('STORM', 3)).toBe(false)
    expect(isSevereWeather('SNOW', 1)).toBe(false)
    expect(isSevereWeather('RAIN', 5)).toBe(false)
    expect(isSevereWeather('CLEAR', 5)).toBe(false)
    expect(isSevereWeather('FOG', 5)).toBe(false)
    expect(isSevereWeather('CLOUDY', 5)).toBe(false)
  })
})

describe('weather -> war attrition', () => {
  const war = { id: 'war-1' }

  it('adds +1 military attrition to both sides in severe weather', () => {
    const d = decideWarProgress(war, { military: 80 }, { military: 80 }, 5, { condition: 'STORM', severity: 5 })
    expect(d.attackerMilitaryDelta).toBe(-3)
    expect(d.defenderMilitaryDelta).toBe(-3)
    // Resources untouched — storms kill soldiers, not treasuries.
    expect(d.attackerResourceDelta).toBe(-3)
    expect(d.defenderResourceDelta).toBe(-3)
  })

  it('keeps the flat -2 military attrition without weather (pre-weather behavior)', () => {
    const d = decideWarProgress(war, { military: 80 }, { military: 80 }, 5)
    expect(d.attackerMilitaryDelta).toBe(-2)
    expect(d.defenderMilitaryDelta).toBe(-2)
  })

  it('keeps the flat -2 attrition in non-severe weather', () => {
    const d = decideWarProgress(war, { military: 80 }, { military: 80 }, 5, { condition: 'RAIN', severity: 5 })
    expect(d.attackerMilitaryDelta).toBe(-2)
    expect(d.defenderMilitaryDelta).toBe(-2)
  })

  it('is symmetric — weather does not take sides', () => {
    const d = decideWarProgress(war, { military: 80 }, { military: 80 }, 5, { condition: 'SNOW', severity: 4 })
    expect(d.attackerMilitaryDelta).toBe(d.defenderMilitaryDelta)
  })
})

describe('influence -> war declaration', () => {
  const defender = { id: 'def', military: 80 }
  const locations = [{ id: 'prize', ownerFactionId: 'def', isContested: true }]

  it('blocks declaration when the attacker influence is in the LOW band', () => {
    const d = decideWarDeclaration({ id: 'att', military: 80, influence: 10 }, defender, locations)
    expect(d.shouldDeclare).toBe(false)
    expect(d.influenceHesitation).toBe(true)
  })

  it('declares when the attacker has standing (influence in MEDIUM+)', () => {
    const d = decideWarDeclaration({ id: 'att', military: 80, influence: 50 }, defender, locations)
    expect(d.shouldDeclare).toBe(true)
    expect(d.influenceHesitation).toBeUndefined()
  })

  it('boundary: influence exactly 34 (MEDIUM floor) still declares', () => {
    const d = decideWarDeclaration({ id: 'att', military: 80, influence: 34 }, defender, locations)
    expect(d.shouldDeclare).toBe(true)
  })

  it('boundary: influence 33 (LOW) hesitates', () => {
    const d = decideWarDeclaration({ id: 'att', military: 80, influence: 33 }, defender, locations)
    expect(d.shouldDeclare).toBe(false)
    expect(d.influenceHesitation).toBe(true)
  })

  it('behaves exactly as before when influence is absent (old fixtures stay green)', () => {
    const d = decideWarDeclaration({ id: 'att', military: 80 }, defender, locations)
    expect(d.shouldDeclare).toBe(true)
    expect(d.influenceHesitation).toBeUndefined()
  })
})

describe('weather -> migration destination choice', () => {
  it('weatherPenalty is 1 for severe weather, 0 otherwise', () => {
    expect(weatherPenalty({ id: 'a', name: 'A', conditionScore: 70, population: null, weather: 'STORM', weatherSeverity: 5 })).toBe(1)
    expect(weatherPenalty({ id: 'a', name: 'A', conditionScore: 70, population: null, weather: 'CLEAR', weatherSeverity: 1 })).toBe(0)
    expect(weatherPenalty({ id: 'a', name: 'A', conditionScore: 70, population: null })).toBe(0)
  })

  it('prefers a clear-weather destination over an equal-condition storm haven', () => {
    const { npcMoves } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 10, population: null }],
      [
        { id: 'stormhaven', name: 'Stormhaven', conditionScore: 70, population: null, weather: 'STORM', weatherSeverity: 5 },
        { id: 'clearwater', name: 'Clearwater', conditionScore: 70, population: null, weather: 'CLEAR', weatherSeverity: 1 },
      ],
      [{ id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true }]
    )
    expect(npcMoves[0].toLocationId).toBe('clearwater')
  })

  it('condition stays primary — a much healthier storm haven still wins', () => {
    const { npcMoves } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 10, population: null }],
      [
        { id: 'stormhaven', name: 'Stormhaven', conditionScore: 90, population: null, weather: 'STORM', weatherSeverity: 5 },
        { id: 'clearwater', name: 'Clearwater', conditionScore: 70, population: null, weather: 'CLEAR', weatherSeverity: 1 },
      ],
      [{ id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true }]
    )
    expect(npcMoves[0].toLocationId).toBe('stormhaven')
  })

  it('missing weather on destinations preserves the old highest-condition pick', () => {
    const { npcMoves } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 10, population: null }],
      [
        { id: 'town', name: 'The Town', conditionScore: 60, population: null },
        { id: 'capital', name: 'The Capital', conditionScore: 90, population: null },
      ],
      [{ id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true }]
    )
    expect(npcMoves[0].toLocationId).toBe('capital')
  })
})

describe('rumors -> migration flight (hearsay)', () => {
  const destinations = [{ id: 'haven', name: 'Haven', conditionScore: 80, population: null }]

  it('an NPC flees on a TOLD rumor of doom even when the score is fine', () => {
    const { npcMoves } = decideMigration(
      [],
      destinations,
      [{ id: 'npc1', name: 'Aldric', locationId: 'home', isAlive: true, selfPreservation: 80 }],
      [],
      new Map([['npc1', 'home']])
    )
    expect(npcMoves).toHaveLength(1)
    expect(npcMoves[0]).toMatchObject({ npcId: 'npc1', fromLocationId: 'home', toLocationId: 'haven' })
  })

  it('a dead NPC never flees on a stale TOLD row', () => {
    const { npcMoves } = decideMigration(
      [],
      destinations,
      [{ id: 'npc1', name: 'Aldric', locationId: 'home', isAlive: false, selfPreservation: 80 }],
      [],
      new Map([['npc1', 'home']])
    )
    expect(npcMoves).toHaveLength(0)
  })

  it('a rumor about somewhere else does not move the NPC', () => {
    const { npcMoves } = decideMigration(
      [],
      destinations,
      [{ id: 'npc1', name: 'Aldric', locationId: 'home', isAlive: true, selfPreservation: 80 }],
      [],
      new Map([['npc1', 'faraway']])
    )
    expect(npcMoves).toHaveLength(0)
  })

  it('a fearless NPC (below the stay threshold) ignores the rumor', () => {
    const { npcMoves } = decideMigration(
      [],
      destinations,
      [{ id: 'npc1', name: 'Aldric', locationId: 'home', isAlive: true, selfPreservation: 5 }],
      [],
      new Map([['npc1', 'home']])
    )
    expect(npcMoves).toHaveLength(0)
  })

  it('an NPC at a genuinely distressed location moves once, not twice', () => {
    const { npcMoves } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 10, population: null }],
      destinations,
      [{ id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true, selfPreservation: 80 }],
      [],
      new Map([['npc1', 'ruins']])
    )
    expect(npcMoves).toHaveLength(1)
  })

  it('hearsay flight produces no background population shift (only named NPCs act on rumors)', () => {
    const { populationShifts, populationFlights } = decideMigration(
      [],
      destinations,
      [{ id: 'npc1', name: 'Aldric', locationId: 'home', isAlive: true, selfPreservation: 80 }],
      [],
      new Map([['npc1', 'home']])
    )
    expect(populationShifts).toHaveLength(0)
    expect(populationFlights).toHaveLength(0)
  })

  it('no destinations means even a terrified NPC stays put', () => {
    const { npcMoves } = decideMigration(
      [],
      [],
      [{ id: 'npc1', name: 'Aldric', locationId: 'home', isAlive: true, selfPreservation: 80 }],
      [],
      new Map([['npc1', 'home']])
    )
    expect(npcMoves).toHaveLength(0)
  })
})

describe('weather -> logistics supply routes', () => {
  const locations = [
    { locationId: 'mine', resourceSlots: ['iron'], ownerFactionId: 'f1' },
    { locationId: 'town', resourceSlots: [] as string[], ownerFactionId: 'f1' },
  ]
  const routes = [{ fromLocationId: 'mine', toLocationId: 'town', isBlockaded: false }]

  it('a severe storm at one end breaks the route for the tick', () => {
    const decisions = decideExtraction(locations, routes, new Map([
      ['mine', { condition: 'STORM' as const, severity: 5 }],
      ['town', { condition: 'CLEAR' as const, severity: 1 }],
    ]))
    expect(decisions).toHaveLength(0)
  })

  it('clear weather keeps extraction working', () => {
    const decisions = decideExtraction(locations, routes, new Map([
      ['mine', { condition: 'CLEAR' as const, severity: 1 }],
      ['town', { condition: 'CLEAR' as const, severity: 1 }],
    ]))
    expect(decisions).toHaveLength(1)
    expect(decisions[0].resourceGain).toBe(2)
  })

  it('absent weather map preserves the pre-weather behavior', () => {
    const decisions = decideExtraction(locations, routes)
    expect(decisions).toHaveLength(1)
  })

  it('a lone location (nothing to connect to) still extracts in a storm', () => {
    const decisions = decideExtraction(
      [{ locationId: 'mine', resourceSlots: ['iron'], ownerFactionId: 'f1' }],
      [],
      new Map([['mine', { condition: 'SNOW' as const, severity: 5 }]])
    )
    expect(decisions).toHaveLength(1)
  })
})

describe('season -> location condition drift', () => {
  it('winter bites (-1) and spring heals (+1); summer and autumn are neutral', () => {
    expect(SEASON_CONDITION_MODIFIER.winter).toBe(-1)
    expect(SEASON_CONDITION_MODIFIER.spring).toBe(1)
    expect(SEASON_CONDITION_MODIFIER.summer).toBe(0)
    expect(SEASON_CONDITION_MODIFIER.autumn).toBe(0)
  })

  it('winter cancels a peacetime recovery tick', () => {
    // Peacetime recovery is +1; winter -1 nets to zero.
    const d = decideConditionDrift({ conditionScore: 50 }, false, false, SEASON_CONDITION_MODIFIER.winter)
    expect(d.nextConditionScore).toBe(50)
  })

  it('spring doubles a peacetime recovery tick', () => {
    const d = decideConditionDrift({ conditionScore: 50 }, false, false, SEASON_CONDITION_MODIFIER.spring)
    expect(d.nextConditionScore).toBe(52)
  })

  it('undefined season falls back to no modifier (pre-season behavior)', () => {
    const d = decideConditionDrift({ conditionScore: 50 }, false, false)
    expect(d.nextConditionScore).toBe(51)
  })

  it('war damage still dominates the seasonal nudge', () => {
    const d = decideConditionDrift({ conditionScore: 50 }, true, false, SEASON_CONDITION_MODIFIER.spring)
    expect(d.nextConditionScore).toBe(43) // -8 war + 1 spring
  })
})

describe('rumors -> disposition hearsay', () => {
  const base = { selfPreservation: 50, loyalty: 50, ambition: 50 }

  it('hearing of a faction fall erodes loyalty by 2 (half the direct rate)', () => {
    const next = decideDispositionDrift(base, [{ kind: 'HEARD_FACTION_FALL' }])
    expect(next.loyalty).toBe(48)
    expect(next.selfPreservation).toBe(50)
    expect(next.ambition).toBe(50)
  })

  it('two rumors stack, bounded by the 0-100 clamp', () => {
    const next = decideDispositionDrift(base, [{ kind: 'HEARD_FACTION_FALL' }, { kind: 'HEARD_FACTION_FALL' }])
    expect(next.loyalty).toBe(46)
    const floored = decideDispositionDrift({ ...base, loyalty: 1 }, [{ kind: 'HEARD_FACTION_FALL' }])
    expect(floored.loyalty).toBe(0)
  })

  it('direct FACTION_LOST still hits twice as hard as hearsay (documented 1:2 ratio)', () => {
    const next = decideDispositionDrift(base, [{ kind: 'FACTION_LOST' }])
    expect(next.loyalty).toBe(46) // -4 direct
  })
})

describe('population -> faction manpower', () => {
  const base = { resources: 50, stability: 50, military: 50, goal: 'CONSOLIDATE' as const }

  it('a populace of 100+ grants +1 military (recruitment)', () => {
    const d = decideFactionTick({ ...base, totalPopulation: 500 })
    expect(d.military).toBe(51)
  })

  it('boundary: exactly 100 qualifies', () => {
    const d = decideFactionTick({ ...base, totalPopulation: 100 })
    expect(d.military).toBe(51)
  })

  it('99 people is not an army — no bonus', () => {
    const d = decideFactionTick({ ...base, totalPopulation: 99 })
    expect(d.military).toBe(50)
  })

  it('population zero means no bonus, never a penalty', () => {
    const d = decideFactionTick({ ...base, totalPopulation: 0 })
    expect(d.military).toBe(50)
  })

  it('untracked population (undefined) preserves legacy behavior exactly', () => {
    const d = decideFactionTick(base)
    expect(d.military).toBe(50)
    expect(d.resources).toBe(51) // CONSOLIDATE +1 resources, sanity check
  })

  it('the bonus respects the 0-100 clamp', () => {
    const d = decideFactionTick({ ...base, military: 100, totalPopulation: 9999 })
    expect(d.military).toBe(100)
  })
})

describe('leader ambition -> ambition commitment', () => {
  const base = { name: 'Thornburg Guild', archetype: 'GENERIC' as const, goal: 'ENRICH' as const, resources: 80, hasActiveSpawnedClock: false }

  it('a low-ambition leader never gambles the treasury', () => {
    const d = decideAmbitionTick({ ...base, leaderAmbition: 10 })
    expect(d.shouldSpawn).toBe(false)
  })

  it('boundary: ambition 33 (LOW) blocks, 34 (MEDIUM floor) allows', () => {
    expect(decideAmbitionTick({ ...base, leaderAmbition: 33 }).shouldSpawn).toBe(false)
    expect(decideAmbitionTick({ ...base, leaderAmbition: 34 }).shouldSpawn).toBe(true)
  })

  it('a driven leader spawns as before', () => {
    const d = decideAmbitionTick({ ...base, leaderAmbition: 90 })
    expect(d.shouldSpawn).toBe(true)
  })

  it('no NPC leader (PC-led or leaderless) keeps the pre-gate behavior', () => {
    const d = decideAmbitionTick(base)
    expect(d.shouldSpawn).toBe(true)
  })

  it('the gate does not rescue an otherwise ineligible faction', () => {
    // Low resources still block, even with a maximally ambitious leader.
    const d = decideAmbitionTick({ ...base, resources: 40, leaderAmbition: 100 })
    expect(d.shouldSpawn).toBe(false)
  })
})
