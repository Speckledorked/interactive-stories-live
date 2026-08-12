import { describe, it, expect } from 'vitest'
import { extractWorldStateChanges, extractOutcomeAdherence, extractMoveVariety } from '../worldStateChanges'
import type { AdherenceResult } from '../outcomeAdherence'
import type { MoveVarietyResult } from '../moveVariety'

function makeMoveVariety(overrides: Partial<MoveVarietyResult> = {}): MoveVarietyResult {
  return {
    entries: [{ characterName: 'Kess', band: 'miss', moveUsed: 'inflict harm', normalizedMove: 'inflict harm', repeatsRecent: false }],
    reported: 1,
    unreported: 0,
    repeated: 0,
    ...overrides,
  }
}

function makeAdherence(overrides: Partial<AdherenceResult> = {}): AdherenceResult {
  return {
    entries: [{ characterName: 'Kess', rolled: 'weakHit', narrated: 'weakHit', verdict: 'match' }],
    matched: 1,
    mismatched: 0,
    unreported: 0,
    ambiguous: 0,
    problems: [],
    ...overrides,
  }
}

describe('extractWorldStateChanges', () => {
  it('returns the array when present', () => {
    const consequences = { worldStateChanges: [{ category: 'roll', type: 'rolled', entityName: 'Kess', details: 'x' }] }
    expect(extractWorldStateChanges(consequences)).toHaveLength(1)
  })

  it('returns an empty array for null/undefined/malformed input', () => {
    expect(extractWorldStateChanges(null)).toEqual([])
    expect(extractWorldStateChanges(undefined)).toEqual([])
    expect(extractWorldStateChanges({})).toEqual([])
    expect(extractWorldStateChanges({ worldStateChanges: 'not-an-array' })).toEqual([])
  })
})

describe('extractOutcomeAdherence', () => {
  it('returns the adherence result when present and well-formed', () => {
    const consequences = { worldStateChanges: [], outcomeAdherence: makeAdherence({ mismatched: 1, matched: 0 }) }
    const result = extractOutcomeAdherence(consequences)
    expect(result).not.toBeNull()
    expect(result!.mismatched).toBe(1)
  })

  it('returns null when absent — an older scene resolved before this field existed', () => {
    expect(extractOutcomeAdherence({ worldStateChanges: [] })).toBeNull()
    expect(extractOutcomeAdherence(null)).toBeNull()
    expect(extractOutcomeAdherence(undefined)).toBeNull()
  })

  it('returns null for a malformed value rather than trusting the shape', () => {
    expect(extractOutcomeAdherence({ outcomeAdherence: 'not-an-object' })).toBeNull()
    expect(extractOutcomeAdherence({ outcomeAdherence: { matched: 1 } })).toBeNull() // missing entries[]
  })
})

describe('extractMoveVariety', () => {
  it('returns the move-variety result when present and well-formed', () => {
    const consequences = { worldStateChanges: [], moveVariety: makeMoveVariety({ repeated: 1 }) }
    const result = extractMoveVariety(consequences)
    expect(result).not.toBeNull()
    expect(result!.repeated).toBe(1)
  })

  it('returns null when absent — an older scene resolved before this field existed', () => {
    expect(extractMoveVariety({ worldStateChanges: [] })).toBeNull()
    expect(extractMoveVariety(null)).toBeNull()
    expect(extractMoveVariety(undefined)).toBeNull()
  })

  it('returns null for a malformed value rather than trusting the shape', () => {
    expect(extractMoveVariety({ moveVariety: 'not-an-object' })).toBeNull()
    expect(extractMoveVariety({ moveVariety: { reported: 1 } })).toBeNull() // missing entries[]
  })
})
