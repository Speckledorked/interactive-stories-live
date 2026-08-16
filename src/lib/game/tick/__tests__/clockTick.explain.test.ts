// src/lib/game/tick/__tests__/clockTick.explain.test.ts
// #126 — explainClockAdvancement is the WITH-reasoning half of
// decideClockAdvancement (already covered indirectly via worldTurn.ts's
// re-export in worldTurn.test.ts); this pins the reasoning trace itself
// and confirms decideClockAdvancement stays a thin wrapper over it.

import { describe, it, expect } from 'vitest'
import { decideClockAdvancement, explainClockAdvancement, FactionForClockAdvancement } from '../clockTick'

const strongFaction: FactionForClockAdvancement = { resources: 80, military: 80, stability: 80, isActive: true }
const weakFaction: FactionForClockAdvancement = { resources: 10, military: 10, stability: 10, isActive: true }
const collapsedFaction: FactionForClockAdvancement = { resources: 80, military: 80, stability: 0, isActive: false }

function baseClock(overrides: Partial<{
  id: string
  category: string | null
  sourceFactionId: string | null
  relatedFactionId: string | null
  participantNpcIds: string[]
}> = {}) {
  return {
    id: 'clock-1',
    category: null,
    sourceFactionId: null,
    relatedFactionId: null,
    participantNpcIds: [],
    ...overrides,
  }
}

describe('explainClockAdvancement — agrees with decideClockAdvancement on the number', () => {
  it('matches for a faction-ambition clock', () => {
    const factionById = new Map([['f1', strongFaction]])
    const clock = baseClock({ sourceFactionId: 'f1' })
    expect(explainClockAdvancement(clock, factionById, 5).advanceAmount)
      .toBe(decideClockAdvancement(clock, factionById, 5))
  })

  it('matches for a collapsed source faction', () => {
    const factionById = new Map([['f1', collapsedFaction]])
    const clock = baseClock({ sourceFactionId: 'f1' })
    expect(explainClockAdvancement(clock, factionById, 5).advanceAmount)
      .toBe(decideClockAdvancement(clock, factionById, 5))
  })

  it('matches for a related-faction front clock across many turns', () => {
    const factionById = new Map([['f1', weakFaction]])
    for (let t = 0; t < 20; t++) {
      const clock = baseClock({ id: `c${t}`, relatedFactionId: 'f1' })
      expect(explainClockAdvancement(clock, factionById, t).advanceAmount)
        .toBe(decideClockAdvancement(clock, factionById, t))
    }
  })

  it('matches for a joint NPC scheme clock', () => {
    const clock = baseClock({ participantNpcIds: ['npc-1', 'npc-2'] })
    expect(explainClockAdvancement(clock, new Map(), 3).advanceAmount)
      .toBe(decideClockAdvancement(clock, new Map(), 3))
  })

  it('matches for unlinked category-paced clocks across many turns', () => {
    for (let t = 0; t < 20; t++) {
      const urgent = baseClock({ id: `u${t}`, category: 'urgent' })
      const slow = baseClock({ id: `s${t}`, category: 'slow' })
      const def = baseClock({ id: `d${t}`, category: null })
      expect(explainClockAdvancement(urgent, new Map(), t).advanceAmount).toBe(decideClockAdvancement(urgent, new Map(), t))
      expect(explainClockAdvancement(slow, new Map(), t).advanceAmount).toBe(decideClockAdvancement(slow, new Map(), t))
      expect(explainClockAdvancement(def, new Map(), t).advanceAmount).toBe(decideClockAdvancement(def, new Map(), t))
    }
  })
})

describe('explainClockAdvancement — reasoning text', () => {
  it('explains a collapsed source faction stalling the clock', () => {
    const factionById = new Map([['f1', collapsedFaction]])
    const { reasoning } = explainClockAdvancement(baseClock({ sourceFactionId: 'f1' }), factionById, 5)
    expect(reasoning.join(' ')).toMatch(/no longer active/i)
  })

  it('explains a strong faction\'s ambition strength band', () => {
    const factionById = new Map([['f1', strongFaction]])
    const { reasoning } = explainClockAdvancement(baseClock({ sourceFactionId: 'f1' }), factionById, 5)
    expect(reasoning.join(' ')).toMatch(/HIGH/)
    expect(reasoning.join(' ')).toMatch(/tracked ambition/i)
  })

  it('explains a related-faction front\'s instability threshold', () => {
    const factionById = new Map([['f1', weakFaction]])
    const { reasoning } = explainClockAdvancement(baseClock({ relatedFactionId: 'f1' }), factionById, 5)
    expect(reasoning.join(' ')).toMatch(/front/i)
    expect(reasoning.join(' ')).toMatch(/instability/i)
  })

  it('explains a joint NPC scheme as guaranteed progress', () => {
    const { reasoning } = explainClockAdvancement(baseClock({ participantNpcIds: ['npc-1', 'npc-2'] }), new Map(), 3)
    expect(reasoning.join(' ')).toMatch(/joint NPC scheme/i)
    expect(reasoning.join(' ')).toMatch(/guaranteed/i)
  })

  it('explains an urgent unattached clock as always advancing', () => {
    const { reasoning, advanceAmount } = explainClockAdvancement(baseClock({ category: 'urgent' }), new Map(), 3)
    expect(advanceAmount).toBe(1)
    expect(reasoning.join(' ')).toMatch(/urgent/i)
    expect(reasoning.join(' ')).toMatch(/always advances/i)
  })

  it('explains a category-paced clock\'s roll threshold', () => {
    const { reasoning } = explainClockAdvancement(baseClock({ category: 'slow' }), new Map(), 3)
    expect(reasoning.join(' ')).toMatch(/category-paced/i)
    expect(reasoning.join(' ')).toMatch(/roll threshold/i)
  })
})

describe('the pacing roll actually depends on the turn (#374)', () => {
  // This is the property a frozen turn counter destroys, and the reason
  // #374 reached one function further than its original fix.
  //
  // advanceClocks read WorldMeta.currentTurnNumber — the SCENE counter —
  // and fed it into `stableHash(clock.id:turnNumber:salt)`. On an idle
  // campaign that counter never moves, so the hash was constant and every
  // category-paced clock either advanced EVERY turn forever or NEVER
  // advanced, decided once and permanently by its id.
  //
  // Nothing caught it because the branches that don't consult the roll —
  // 'urgent', and any clock with a faction or NPC driver — behaved
  // identically either way, and they are the branches fixtures reach for.
  const unattached = (id: string) => ({
    id,
    category: 'default' as string | null,
    sourceFactionId: null,
    relatedFactionId: null,
    participantNpcIds: [] as string[],
  })

  it('does not return the same answer for every turn of a given clock', () => {
    const clock = unattached('clock-1')
    const decisions = Array.from({ length: 40 }, (_, turn) =>
      decideClockAdvancement(clock, new Map(), turn)
    )

    // Both outcomes have to be reachable for the same clock across turns.
    // With a frozen turn number this set has exactly one member.
    expect(new Set(decisions).size).toBeGreaterThan(1)
  })

  it('is still deterministic for a given (clock, turn) pair', () => {
    // The fix is "vary with the turn", not "become random" — a dry-run
    // preview and the real turn must still agree.
    const clock = unattached('clock-1')
    for (const turn of [0, 1, 7, 30]) {
      expect(decideClockAdvancement(clock, new Map(), turn)).toBe(
        decideClockAdvancement(clock, new Map(), turn)
      )
    }
  })

  it('does not move every clock in lockstep on the same turn', () => {
    // The salt includes the clock id, so two clocks on the same turn are
    // independent — otherwise a campaign's whole clock board would advance
    // or stall together.
    const onTurn7 = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) =>
      decideClockAdvancement(unattached(id), new Map(), 7)
    )

    expect(new Set(onTurn7).size).toBeGreaterThan(1)
  })
})
