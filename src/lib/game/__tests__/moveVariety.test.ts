// src/lib/game/__tests__/moveVariety.test.ts
//
// #232: outcome-band move selection had no server-side signal at all —
// nothing captured which move the model actually picked. These tests pin
// the "ask, don't infer" measurement layer: normalization of the model's
// free-text self-report against the closed move vocabulary, bounded
// recent-move history, and the pure variety check itself.

import { describe, it, expect } from 'vitest'
import {
  normalizeMoveUsed,
  trackRecentMoves,
  checkMoveVariety,
  MAX_RECENT_MOVES,
  WEAK_HIT_MOVES,
  MISS_MOVES,
} from '../moveVariety'

describe('normalizeMoveUsed', () => {
  it('matches an exact canonical phrase', () => {
    expect(normalizeMoveUsed('inflict harm')).toBe('inflict harm')
    expect(normalizeMoveUsed('extract a cost')).toBe('extract a cost')
  })

  it('is lenient about case, whitespace, and trailing punctuation', () => {
    expect(normalizeMoveUsed('  Inflict Harm.  ')).toBe('inflict harm')
    expect(normalizeMoveUsed('EXTRACT A COST!')).toBe('extract a cost')
  })

  it('matches via containment when the model adds surrounding words', () => {
    expect(normalizeMoveUsed('used inflict harm on them')).toBe('inflict harm')
  })

  it('returns null for unrecognizable text', () => {
    expect(normalizeMoveUsed('did something clever')).toBeNull()
  })

  it('returns null for undefined/null/empty', () => {
    expect(normalizeMoveUsed(undefined)).toBeNull()
    expect(normalizeMoveUsed(null)).toBeNull()
    expect(normalizeMoveUsed('')).toBeNull()
    expect(normalizeMoveUsed('   ')).toBeNull()
  })

  it('covers every WEAK_HIT_MOVES and MISS_MOVES entry exactly', () => {
    for (const move of [...WEAK_HIT_MOVES, ...MISS_MOVES]) {
      expect(normalizeMoveUsed(move)).toBe(move)
    }
  })
})

describe('trackRecentMoves', () => {
  it('appends new moves to an empty history', () => {
    expect(trackRecentMoves([], ['inflict harm'])).toEqual(['inflict harm'])
  })

  it('keeps repeats — they are exactly the signal this exists to surface', () => {
    expect(trackRecentMoves(['inflict harm'], ['inflict harm'])).toEqual(['inflict harm', 'inflict harm'])
  })

  it('bounds at MAX_RECENT_MOVES, dropping the oldest', () => {
    const existing = Array.from({ length: MAX_RECENT_MOVES }, (_, i) => `move ${i}`)
    const result = trackRecentMoves(existing, ['new move'])
    expect(result).toHaveLength(MAX_RECENT_MOVES)
    expect(result[0]).toBe('move 1') // "move 0" dropped
    expect(result.at(-1)).toBe('new move')
  })

  it('filters out falsy entries', () => {
    expect(trackRecentMoves([], ['inflict harm', '', null as unknown as string])).toEqual(['inflict harm'])
  })
})

describe('checkMoveVariety', () => {
  it('returns an empty result for no outcome_echo', () => {
    const result = checkMoveVariety(undefined, [])
    expect(result).toEqual({ entries: [], reported: 0, unreported: 0, repeated: 0 })
  })

  it('skips strongHit entries — nothing to pick from a menu that does not apply', () => {
    const result = checkMoveVariety(
      [{ character_name_or_id: 'Jason', outcome: 'strongHit', move_used: 'inflict harm' }],
      []
    )
    expect(result.entries).toEqual([])
  })

  it('counts a classifiable move_used as reported', () => {
    const result = checkMoveVariety(
      [{ character_name_or_id: 'Jason', outcome: 'miss', move_used: 'inflict harm' }],
      []
    )
    expect(result.reported).toBe(1)
    expect(result.unreported).toBe(0)
    expect(result.entries[0]).toMatchObject({
      characterName: 'Jason',
      band: 'miss',
      moveUsed: 'inflict harm',
      normalizedMove: 'inflict harm',
      repeatsRecent: false,
    })
  })

  it('counts a missing or unclassifiable move_used as unreported', () => {
    const missing = checkMoveVariety([{ character_name_or_id: 'Jason', outcome: 'miss' }], [])
    expect(missing.unreported).toBe(1)
    expect(missing.reported).toBe(0)

    const unclassifiable = checkMoveVariety(
      [{ character_name_or_id: 'Jason', outcome: 'weakHit', move_used: 'something unrecognizable' }],
      []
    )
    expect(unclassifiable.unreported).toBe(1)
  })

  it('flags a move that repeats one already used earlier this scene', () => {
    const result = checkMoveVariety(
      [{ character_name_or_id: 'Jason', outcome: 'miss', move_used: 'inflict harm' }],
      ['inflict harm', 'drain a tracked resource']
    )
    expect(result.repeated).toBe(1)
    expect(result.entries[0].repeatsRecent).toBe(true)
  })

  it('does not flag a genuinely varied move', () => {
    const result = checkMoveVariety(
      [{ character_name_or_id: 'Jason', outcome: 'miss', move_used: 'advance a threat clock' }],
      ['inflict harm', 'drain a tracked resource']
    )
    expect(result.repeated).toBe(0)
    expect(result.entries[0].repeatsRecent).toBe(false)
  })

  it('handles multiple entries independently', () => {
    const result = checkMoveVariety(
      [
        { character_name_or_id: 'Jason', outcome: 'miss', move_used: 'inflict harm' },
        { character_name_or_id: 'Ava', outcome: 'weakHit', move_used: 'extract a cost' },
        { character_name_or_id: 'Kess', outcome: 'strongHit' },
      ],
      ['inflict harm']
    )
    expect(result.entries).toHaveLength(2) // strongHit skipped
    expect(result.reported).toBe(2)
    expect(result.repeated).toBe(1) // only Jason's repeats
  })
})
