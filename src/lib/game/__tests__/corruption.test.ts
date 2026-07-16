// src/lib/game/__tests__/corruption.test.ts
import { describe, it, expect } from 'vitest'
import {
  MAX_CORRUPTION,
  parseCorruptionTheme,
  applyCorruptionMarks,
  corruptionStage,
  describeCorruptionForPrompt,
} from '../corruption'

const theme = {
  name: 'The Whispering Debt',
  description: 'Power borrowed from something that keeps score.',
  stages: [
    'You hear it when the room goes quiet.',
    'It answers before you ask.',
    'Your reflection lags behind you.',
    'It spends you like currency.',
    'There is no you left to spend.',
  ],
}

describe('parseCorruptionTheme', () => {
  it('returns null for null/malformed/empty-stage input', () => {
    expect(parseCorruptionTheme(null)).toBeNull()
    expect(parseCorruptionTheme('nope')).toBeNull()
    expect(parseCorruptionTheme({ name: 'X' })).toBeNull()
    expect(parseCorruptionTheme({ name: 'X', description: 'y', stages: [] })).toBeNull()
  })

  it('parses a valid theme', () => {
    const parsed = parseCorruptionTheme(theme)
    expect(parsed?.name).toBe('The Whispering Debt')
    expect(parsed?.stages).toHaveLength(5)
  })
})

describe('applyCorruptionMarks', () => {
  it('applies exactly one mark per scene no matter how many were requested', () => {
    expect(applyCorruptionMarks(0, 1)).toEqual({ newValue: 1, applied: 1, reachedMax: false })
    expect(applyCorruptionMarks(0, 3)).toEqual({ newValue: 1, applied: 1, reachedMax: false })
  })

  it('never decreases: zero and negative requests are no-ops', () => {
    expect(applyCorruptionMarks(2, 0)).toEqual({ newValue: 2, applied: 0, reachedMax: false })
    expect(applyCorruptionMarks(2, -1)).toEqual({ newValue: 2, applied: 0, reachedMax: false })
  })

  it('caps at MAX_CORRUPTION and reports reaching it', () => {
    expect(applyCorruptionMarks(MAX_CORRUPTION - 1, 1)).toEqual({
      newValue: MAX_CORRUPTION, applied: 1, reachedMax: true,
    })
    expect(applyCorruptionMarks(MAX_CORRUPTION, 1)).toEqual({
      newValue: MAX_CORRUPTION, applied: 0, reachedMax: true,
    })
  })

  it('sanitizes garbage current values', () => {
    expect(applyCorruptionMarks(-3, 1).newValue).toBe(1)
    expect(applyCorruptionMarks(99, 1).newValue).toBe(MAX_CORRUPTION)
  })
})

describe('corruptionStage', () => {
  it('is null at zero and returns the matching stage otherwise', () => {
    expect(corruptionStage(theme, 0)).toBeNull()
    expect(corruptionStage(theme, 1)).toBe(theme.stages[0])
    expect(corruptionStage(theme, 5)).toBe(theme.stages[4])
  })

  it('clamps past the end of a short stages array', () => {
    const short = { ...theme, stages: ['only stage'] }
    expect(corruptionStage(short, 4)).toBe('only stage')
  })
})

describe('describeCorruptionForPrompt', () => {
  it('describes untouched, touched, deep, and consumed states without bare numbers', () => {
    expect(describeCorruptionForPrompt(theme, 0)).toContain('untouched')
    expect(describeCorruptionForPrompt(theme, 1)).toContain('touched by')
    expect(describeCorruptionForPrompt(theme, 3)).toContain('deep in')
    expect(describeCorruptionForPrompt(theme, 5)).toContain('fully consumed')
    expect(describeCorruptionForPrompt(theme, 3)).not.toMatch(/\b3\b/)
  })
})
