// src/lib/game/__tests__/socialTies.test.ts
//
// NPC society reaching the dice (#89). socialTies was written by the tick
// and read by one wiki sentence and joint-scheme clock spawning — never by
// anything a player could feel. These cover the consumer that changed
// that, and especially the two properties that keep it honest: it's an
// echo rather than a second relationship, and being in with someone's
// enemy costs you.

import { describe, it, expect } from 'vitest'
import {
  reflectedRapportModifier,
  parseSocialTies,
  netGoodwill,
  describeReflectedRapport,
  REFLECTED_RAPPORT_CAP,
  REFLECTION_THRESHOLD,
} from '../socialTies'

const warm = { trust: 60, respect: 40, tension: 0 }   // +100
const cold = { trust: 0, respect: 0, tension: 90 }    // -90
const lukewarm = { trust: 20, respect: 10, tension: 0 } // +30, under threshold

describe('parseSocialTies', () => {
  it('keeps only real tie types', () => {
    // #373: the input is the projection of a typed enum column now, so the
    // unknown-type case is only reachable if TieType grows a third member.
    // Kept — this module has an opinion about ALLY and RIVAL and none about
    // anything else, and silently reflecting rapport through a tie type it
    // does not understand is the failure worth preventing.
    const ties = { a: { type: 'ALLY' }, b: { type: 'RIVAL' }, c: { type: 'FRENEMY' } } as any
    expect(parseSocialTies(ties)).toEqual({ a: { type: 'ALLY' }, b: { type: 'RIVAL' } })
  })

  it('reads an absent or empty tie set as no ties', () => {
    expect(parseSocialTies(null)).toEqual({})
    expect(parseSocialTies(undefined)).toEqual({})
    expect(parseSocialTies({})).toEqual({})
    // A malformed entry drops out rather than throwing — the projection
    // comes from a map lookup, and a missing key reads as undefined.
    expect(parseSocialTies({ a: null } as any)).toEqual({})
  })
})

describe('netGoodwill', () => {
  it('is trust plus respect minus tension', () => {
    expect(netGoodwill({ trust: 50, respect: 30, tension: 20 })).toBe(60)
  })

  it('ignores fear, the same way relationshipModifier does', () => {
    // Fear is an asset for intimidation and a liability for persuasion,
    // and nothing here knows which is being attempted.
    expect(netGoodwill({ trust: 0, respect: 0, tension: 0, fear: 100 })).toBe(0)
  })

  it('treats missing and malformed values as zero', () => {
    expect(netGoodwill({})).toBe(0)
    expect(netGoodwill(null)).toBe(0)
    expect(netGoodwill({ trust: 'lots' as unknown as number })).toBe(0)
  })
})

describe('reflectedRapportModifier', () => {
  it('an ally hearing good things warms the NPC to you', () => {
    expect(reflectedRapportModifier({ n2: { type: 'ALLY' } }, { n2: warm })).toBe(1)
  })

  it('being well in with their RIVAL counts against you', () => {
    // The half that makes this a social position rather than a bonus
    // track: a reputation you can only gain would not be a reputation.
    expect(reflectedRapportModifier({ n2: { type: 'RIVAL' } }, { n2: warm })).toBe(-1)
  })

  it("an ally's enemy is warmed toward you", () => {
    // You wronged their rival — that plays well.
    expect(reflectedRapportModifier({ n2: { type: 'RIVAL' } }, { n2: cold })).toBe(1)
  })

  it("an ally you have wronged colors them against you", () => {
    expect(reflectedRapportModifier({ n2: { type: 'ALLY' } }, { n2: cold })).toBe(-1)
  })

  it('ignores rapport too mild to be worth mentioning', () => {
    // Hearing you are "slightly on good terms" with someone changes nothing.
    expect(reflectedRapportModifier({ n2: { type: 'ALLY' } }, { n2: lukewarm })).toBe(0)
    expect(netGoodwill(lukewarm)).toBeLessThan(REFLECTION_THRESHOLD)
  })

  it('nets opposing signals against each other', () => {
    // Loved by their ally, loved by their rival: it washes out.
    expect(reflectedRapportModifier(
      { n2: { type: 'ALLY' }, n3: { type: 'RIVAL' } },
      { n2: warm, n3: warm }
    )).toBe(0)
  })

  it('stays an echo, never louder than the relationship itself', () => {
    // Direct rapport caps at ±2. A reputation that outweighed the person
    // in front of you would make direct rapport pointless.
    const manyAllies = Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e'].map(id => [id, { type: 'ALLY' as const }])
    )
    const allWarm = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map(id => [id, warm]))
    expect(reflectedRapportModifier(manyAllies, allWarm)).toBe(REFLECTED_RAPPORT_CAP)

    const allCold = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map(id => [id, cold]))
    expect(reflectedRapportModifier(manyAllies, allCold)).toBe(-REFLECTED_RAPPORT_CAP)
  })

  it('contributes nothing for an NPC with no ties on record', () => {
    // Every NPC in a campaign whose society tick has never run.
    expect(reflectedRapportModifier(null, { n2: warm })).toBe(0)
    expect(reflectedRapportModifier({}, { n2: warm })).toBe(0)
  })

  it('contributes nothing for a character who has met nobody', () => {
    expect(reflectedRapportModifier({ n2: { type: 'ALLY' } }, null)).toBe(0)
    expect(reflectedRapportModifier({ n2: { type: 'ALLY' } }, {})).toBe(0)
  })

  it('ignores ties to third parties the character has no rapport with', () => {
    expect(reflectedRapportModifier(
      { n2: { type: 'ALLY' }, unknown: { type: 'RIVAL' } },
      { n2: warm }
    )).toBe(1)
  })
})

describe('describeReflectedRapport', () => {
  it('speaks diegetically, never in numbers', () => {
    for (const mod of [1, -1]) {
      expect(describeReflectedRapport(mod)).not.toMatch(/\d/)
    }
    expect(describeReflectedRapport(1)).not.toBe(describeReflectedRapport(-1))
  })
})
