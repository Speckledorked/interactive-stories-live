// src/lib/game/__tests__/advancementTrack.test.ts
//
// The gap: a player learned in the fiction that essences exist and that ranks
// run unranked -> iron -> bronze, and the sheet could say nothing about
// either — known facts are free text, and no structure existed to render.
//
// The constraint that shapes every test below: NULL IS A CORRECT ANSWER. A
// universe with no ranks must render nothing rather than get a ladder
// invented for it, exactly as a null corruptionTheme disables that track.

import { describe, it, expect } from 'vitest'
import { parseAdvancementTrack, tierProgress, slotProgress } from '../advancementTrack'

const HWFWM = {
  tiers: [
    { key: 'unranked', label: 'Unranked' },
    { key: 'iron', label: 'Iron' },
    { key: 'bronze', label: 'Bronze' },
  ],
  slotGroups: [{ key: 'essences', label: 'Essences', capacity: 4, domain: 'Essence Magic' }],
}

describe('a universe with no progression gets nothing', () => {
  it('returns null rather than inventing a ladder', () => {
    expect(parseAdvancementTrack(null)).toBeNull()
    expect(parseAdvancementTrack({})).toBeNull()
    expect(parseAdvancementTrack({ tiers: [], slotGroups: [] })).toBeNull()
    expect(parseAdvancementTrack('a track')).toBeNull()
  })

  it('renders no progress for a null track', () => {
    expect(tierProgress(null, 'iron')).toBeNull()
    expect(slotProgress(null, ['Essence Magic'])).toEqual([])
  })

  it('rejects a one-rung ladder, which has nowhere to go', () => {
    const track = parseAdvancementTrack({ tiers: [{ key: 'a', label: 'A' }], slotGroups: [] })
    expect(track).toBeNull()
  })

  it('keeps slot groups even when the universe has no ladder', () => {
    const track = parseAdvancementTrack({ tiers: [], slotGroups: HWFWM.slotGroups })
    expect(track?.tiers).toEqual([])
    expect(track?.slotGroups).toHaveLength(1)
  })
})

describe('parsing what the model returned', () => {
  it('accepts a well-formed track', () => {
    expect(parseAdvancementTrack(HWFWM)).toEqual(HWFWM)
  })

  it('accepts snake_case slot_groups, since that is what the prompt asks for', () => {
    const parsed = parseAdvancementTrack({ tiers: HWFWM.tiers, slot_groups: HWFWM.slotGroups })
    expect(parsed?.slotGroups).toHaveLength(1)
  })

  it('drops a slot group with no capacity rather than rendering an unbounded bar', () => {
    const parsed = parseAdvancementTrack({
      tiers: HWFWM.tiers,
      slotGroups: [{ key: 'e', label: 'Essences', domain: 'Essence Magic' }],
    })
    expect(parsed?.slotGroups).toEqual([])
  })

  it('drops a slot group with no domain — nothing could ever fill it', () => {
    const parsed = parseAdvancementTrack({
      tiers: HWFWM.tiers,
      slotGroups: [{ key: 'e', label: 'Essences', capacity: 4 }],
    })
    expect(parsed?.slotGroups).toEqual([])
  })

  it('dedupes rungs by key, so a repeated rank cannot lengthen the ladder', () => {
    const parsed = parseAdvancementTrack({
      tiers: [
        { key: 'iron', label: 'Iron' },
        { key: 'IRON', label: 'Iron again' },
        { key: 'bronze', label: 'Bronze' },
      ],
      slotGroups: [],
    })
    expect(parsed?.tiers.map(t => t.key)).toEqual(['iron', 'bronze'])
  })

  it('clamps a hallucinated capacity instead of drawing 900 boxes', () => {
    const parsed = parseAdvancementTrack({
      tiers: HWFWM.tiers,
      slotGroups: [{ key: 'e', label: 'E', capacity: 900, domain: 'd' }],
    })
    expect(parsed?.slotGroups[0].capacity).toBe(20)
    expect(parseAdvancementTrack({
      tiers: HWFWM.tiers,
      slotGroups: [{ key: 'e', label: 'E', capacity: 0, domain: 'd' }],
    })?.slotGroups[0].capacity).toBe(1)
  })
})

describe('where a character stands', () => {
  const track = parseAdvancementTrack(HWFWM)!

  it('reads an absent tier as the FIRST rung, not as an error', () => {
    // "Unranked" is a real starting state, and a character created before the
    // campaign had a track should look like a beginner, not a broken row.
    expect(tierProgress(track, null)).toEqual({ label: 'Unranked', index: 0, total: 3, next: 'Iron' })
    expect(tierProgress(track, undefined)?.index).toBe(0)
  })

  it('reads an unrecognised tier as the first rung for the same reason', () => {
    expect(tierProgress(track, 'diamond')?.index).toBe(0)
  })

  it('locates a real tier and names what comes next', () => {
    expect(tierProgress(track, 'iron')).toEqual({ label: 'Iron', index: 1, total: 3, next: 'Bronze' })
  })

  it('reports no next rung at the top', () => {
    expect(tierProgress(track, 'bronze')?.next).toBeNull()
  })

  it('matches the tier key case-insensitively', () => {
    expect(tierProgress(track, 'IRON')?.index).toBe(1)
  })
})

describe('slots are counted, not stored', () => {
  const track = parseAdvancementTrack(HWFWM)!

  it('counts the character own capabilities in that domain', () => {
    expect(slotProgress(track, ['Essence Magic', 'Essence Magic', 'Swordplay'])).toEqual([
      { key: 'essences', label: 'Essences', filled: 2, capacity: 4 },
    ])
  })

  it('shows an empty collection as 0 of capacity', () => {
    expect(slotProgress(track, [])[0]).toEqual({ key: 'essences', label: 'Essences', filled: 0, capacity: 4 })
  })

  it('caps at capacity, because 5/4 reads as a bug rather than abundance', () => {
    const many = ['Essence Magic', 'Essence Magic', 'Essence Magic', 'Essence Magic', 'Essence Magic']
    expect(slotProgress(track, many)[0].filled).toBe(4)
  })

  it('matches the domain case-insensitively and ignores junk', () => {
    expect(slotProgress(track, ['essence magic', '  ', null as unknown as string])[0].filled).toBe(1)
  })
})
