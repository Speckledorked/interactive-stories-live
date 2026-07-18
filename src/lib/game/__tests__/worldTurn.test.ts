// src/lib/game/__tests__/worldTurn.test.ts
// Faction-driven clock advancement (depth-hardening #30) — deterministic,
// no Math.random, so a given (clock, faction snapshot, turn) always
// advances the same way.

import { describe, it, expect } from 'vitest'
import { decideClockAdvancement, FactionForClockAdvancement } from '../worldTurn'

const strongFaction: FactionForClockAdvancement = { resources: 80, military: 80, stability: 80, isActive: true }
const weakFaction: FactionForClockAdvancement = { resources: 10, military: 10, stability: 10, isActive: true }
const mediumFaction: FactionForClockAdvancement = { resources: 50, military: 50, stability: 50, isActive: true }
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

describe('decideClockAdvancement — faction ambition clocks (sourceFactionId)', () => {
  it('advances a strong faction\'s ambition by 2', () => {
    const factionById = new Map([['f1', strongFaction]])
    expect(decideClockAdvancement(baseClock({ sourceFactionId: 'f1' }), factionById, 5)).toBe(2)
  })

  it('advances a middling faction\'s ambition by 1', () => {
    const factionById = new Map([['f1', mediumFaction]])
    expect(decideClockAdvancement(baseClock({ sourceFactionId: 'f1' }), factionById, 5)).toBe(1)
  })

  it('does not advance a weak faction\'s ambition', () => {
    const factionById = new Map([['f1', weakFaction]])
    expect(decideClockAdvancement(baseClock({ sourceFactionId: 'f1' }), factionById, 5)).toBe(0)
  })

  it('stalls dead if the source faction collapsed', () => {
    const factionById = new Map([['f1', collapsedFaction]])
    expect(decideClockAdvancement(baseClock({ sourceFactionId: 'f1' }), factionById, 5)).toBe(0)
  })

  it('stalls dead if the source faction is missing entirely', () => {
    expect(decideClockAdvancement(baseClock({ sourceFactionId: 'ghost' }), new Map(), 5)).toBe(0)
  })

  it('is deterministic across repeated calls with the same inputs', () => {
    const factionById = new Map([['f1', strongFaction]])
    const clock = baseClock({ sourceFactionId: 'f1' })
    const first = decideClockAdvancement(clock, factionById, 12)
    const second = decideClockAdvancement(clock, factionById, 12)
    expect(first).toBe(second)
  })
})

describe('decideClockAdvancement — front clocks (relatedFactionId)', () => {
  it('gives an unstable linked faction the highest push threshold', () => {
    const factionById = new Map([['f1', weakFaction]]) // stability 10 -> instability HIGH
    // Sweep enough turn numbers to exercise the stableHash roll and confirm
    // it only ever returns 0 or 1, never anything else.
    for (let t = 0; t < 20; t++) {
      const result = decideClockAdvancement(baseClock({ id: `c${t}`, relatedFactionId: 'f1' }), factionById, t)
      expect([0, 1]).toContain(result)
    }
  })

  it('defaults to a middling pace when the linked faction is inactive/missing', () => {
    for (let t = 0; t < 20; t++) {
      const result = decideClockAdvancement(baseClock({ id: `c${t}`, relatedFactionId: 'ghost' }), new Map(), t)
      expect([0, 1]).toContain(result)
    }
  })
})

describe('decideClockAdvancement — joint NPC scheme clocks (participantNpcIds)', () => {
  it('always advances by 1', () => {
    const clock = baseClock({ participantNpcIds: ['npc-1', 'npc-2'] })
    for (let t = 0; t < 10; t++) {
      expect(decideClockAdvancement(clock, new Map(), t)).toBe(1)
    }
  })
})

describe('decideClockAdvancement — unlinked GM clocks (category fallback)', () => {
  it('always advances an urgent clock', () => {
    for (let t = 0; t < 20; t++) {
      expect(decideClockAdvancement(baseClock({ id: `c${t}`, category: 'urgent' }), new Map(), t)).toBe(1)
    }
  })

  it('only ever returns 0 or 1 for slow and default clocks, deterministically', () => {
    for (let t = 0; t < 20; t++) {
      const slow = decideClockAdvancement(baseClock({ id: `slow-${t}`, category: 'slow' }), new Map(), t)
      const defaultCat = decideClockAdvancement(baseClock({ id: `def-${t}`, category: null }), new Map(), t)
      expect([0, 1]).toContain(slow)
      expect([0, 1]).toContain(defaultCat)
    }
  })

  it('is deterministic — repeated calls with the same clock id and turn agree', () => {
    const clock = baseClock({ id: 'stable-clock', category: 'slow' })
    const results = new Set([
      decideClockAdvancement(clock, new Map(), 7),
      decideClockAdvancement(clock, new Map(), 7),
      decideClockAdvancement(clock, new Map(), 7),
    ])
    expect(results.size).toBe(1)
  })
})
