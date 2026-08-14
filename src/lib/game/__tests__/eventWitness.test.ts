// src/lib/game/__tests__/eventWitness.test.ts
//
// #101 (PR 3/3): the pure grouping/capping step between raw EventWitness
// rows and what actually lands in a character's own block of the AI
// prompt.

import { describe, it, expect } from 'vitest'
import { groupEventWitnessesForPrompt, MAX_WITNESSED_EVENTS_IN_PROMPT, MAX_TOLD_EVENTS_IN_PROMPT } from '../eventWitness'
import type { WitnessRow } from '../eventWitness'

function row(overrides: Partial<WitnessRow> = {}): WitnessRow {
  return { characterId: 'c1', grade: 'WITNESSED', turnNumber: 1, reason: 'something happened', ...overrides }
}

describe('groupEventWitnessesForPrompt', () => {
  it('splits WITNESSED and TOLD into separate lists per character', () => {
    const result = groupEventWitnessesForPrompt([
      row({ grade: 'WITNESSED', reason: 'saw the fire', turnNumber: 1 }),
      row({ grade: 'TOLD', reason: 'heard about the flood', turnNumber: 2 }),
    ])

    expect(result.get('c1')).toEqual({
      witnessed: ['saw the fire'],
      told: ['heard about the flood'],
    })
  })

  it('never mixes characters', () => {
    const result = groupEventWitnessesForPrompt([
      row({ characterId: 'a', reason: 'a saw this' }),
      row({ characterId: 'b', reason: 'b saw that' }),
    ])

    expect(result.get('a')).toEqual({ witnessed: ['a saw this'], told: [] })
    expect(result.get('b')).toEqual({ witnessed: ['b saw that'], told: [] })
  })

  it('sorts most-recent-first within each grade', () => {
    const result = groupEventWitnessesForPrompt([
      row({ grade: 'WITNESSED', reason: 'oldest', turnNumber: 1 }),
      row({ grade: 'WITNESSED', reason: 'newest', turnNumber: 3 }),
      row({ grade: 'WITNESSED', reason: 'middle', turnNumber: 2 }),
    ])

    expect(result.get('c1')?.witnessed).toEqual(['newest', 'middle', 'oldest'])
  })

  it('caps WITNESSED independently from TOLD, per character', () => {
    const rows: WitnessRow[] = []
    for (let i = 0; i < MAX_WITNESSED_EVENTS_IN_PROMPT + 3; i++) {
      rows.push(row({ grade: 'WITNESSED', reason: `witnessed-${i}`, turnNumber: i }))
    }
    for (let i = 0; i < MAX_TOLD_EVENTS_IN_PROMPT + 3; i++) {
      rows.push(row({ grade: 'TOLD', reason: `told-${i}`, turnNumber: i }))
    }

    const result = groupEventWitnessesForPrompt(rows)
    expect(result.get('c1')?.witnessed).toHaveLength(MAX_WITNESSED_EVENTS_IN_PROMPT)
    expect(result.get('c1')?.told).toHaveLength(MAX_TOLD_EVENTS_IN_PROMPT)
    // Kept the most recent ones, not an arbitrary slice.
    expect(result.get('c1')?.witnessed[0]).toBe(`witnessed-${MAX_WITNESSED_EVENTS_IN_PROMPT + 2}`)
    expect(result.get('c1')?.told[0]).toBe(`told-${MAX_TOLD_EVENTS_IN_PROMPT + 2}`)
  })

  it('returns an empty map for no rows', () => {
    expect(groupEventWitnessesForPrompt([])).toEqual(new Map())
  })

  it('a character with only TOLD rows gets an empty witnessed array, not undefined', () => {
    const result = groupEventWitnessesForPrompt([row({ grade: 'TOLD', reason: 'a rumor' })])
    expect(result.get('c1')).toEqual({ witnessed: [], told: ['a rumor'] })
  })
})

describe('groupEventWitnessesForPrompt — misinformation (#101)', () => {
  it('bakes a qualifying suffix onto a distorted TOLD line', () => {
    const result = groupEventWitnessesForPrompt([
      row({ grade: 'TOLD', reason: 'the fortress fell', distorted: true, distortionFlavor: 'EXAGGERATED' }),
    ])
    expect(result.get('c1')?.told).toEqual(['the fortress fell (this account sounds exaggerated)'])
  })

  it('one suffix per flavor', () => {
    const flavors: Array<[string, string]> = [
      ['EXAGGERATED', 'sounds exaggerated'],
      ['MINIMIZED', 'sounds downplayed'],
      ['GARBLED_DETAIL', 'seem garbled'],
      ['ATTRIBUTED_WRONG', 'wrong party'],
    ]
    for (const [flavor, expectedSubstring] of flavors) {
      const result = groupEventWitnessesForPrompt([
        row({ grade: 'TOLD', reason: 'something happened', distorted: true, distortionFlavor: flavor }),
      ])
      expect(result.get('c1')?.told[0]).toContain(expectedSubstring)
    }
  })

  it('leaves an undistorted TOLD line untouched (no trailing suffix)', () => {
    const result = groupEventWitnessesForPrompt([
      row({ grade: 'TOLD', reason: 'the fortress fell', distorted: false, distortionFlavor: null }),
    ])
    expect(result.get('c1')?.told).toEqual(['the fortress fell'])
  })

  it('never applies a suffix to a WITNESSED line, even if distorted were somehow set', () => {
    const result = groupEventWitnessesForPrompt([
      row({ grade: 'WITNESSED', reason: 'saw it firsthand', distorted: true, distortionFlavor: 'EXAGGERATED' }),
    ])
    expect(result.get('c1')?.witnessed).toEqual(['saw it firsthand'])
  })

  it('treats a row with no distorted/distortionFlavor fields at all the same as undistorted (backward-compatible with pre-migration callers)', () => {
    const result = groupEventWitnessesForPrompt([row({ grade: 'TOLD', reason: 'plain rumor' })])
    expect(result.get('c1')?.told).toEqual(['plain rumor'])
  })
})
