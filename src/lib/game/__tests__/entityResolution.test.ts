import { describe, it, expect } from 'vitest'
import {
  normalizeEntityName,
  levenshteinDistance,
  isConfidentFuzzyMatch,
  resolveEntityByNameOrId,
} from '../entityResolution'

describe('normalizeEntityName', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    expect(normalizeEntityName('  Lord   Kessler  ')).toBe('lord kessler')
  })
})

describe('levenshteinDistance', () => {
  it('is 0 for identical strings', () => {
    expect(levenshteinDistance('kessler', 'kessler')).toBe(0)
  })

  it('counts a single substitution as distance 1', () => {
    expect(levenshteinDistance('kessler', 'kesler')).toBe(1)
  })

  it('handles empty strings', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3)
    expect(levenshteinDistance('abc', '')).toBe(3)
    expect(levenshteinDistance('', '')).toBe(0)
  })
})

describe('isConfidentFuzzyMatch', () => {
  it('matches a single-letter typo on a longer name', () => {
    expect(isConfidentFuzzyMatch('Lord Kesler', 'Lord Kessler')).toBe(true)
  })

  it('matches case/whitespace-only differences', () => {
    expect(isConfidentFuzzyMatch('  bob  ', 'Bob')).toBe(true)
  })

  it('does NOT match a short, genuinely different name (the old `contains` false-positive case)', () => {
    expect(isConfidentFuzzyMatch('Bob', 'Rob')).toBe(false)
  })

  it('does NOT match a name that is a substring of a much longer, different name', () => {
    // This is exactly the failure mode `contains` had: "Bob" is a substring
    // of "Bobby's Assistant", but they are different entities.
    expect(isConfidentFuzzyMatch('Bob', "Bobby's Assistant")).toBe(false)
  })

  it('does NOT match two unrelated names of similar length', () => {
    expect(isConfidentFuzzyMatch('Marcus Vane', 'Elena Voss')).toBe(false)
  })
})

describe('resolveEntityByNameOrId', () => {
  const roster = [
    { id: 'npc_1', name: 'Lord Kessler' },
    { id: 'npc_2', name: 'Captain Reyes' },
    { id: 'npc_3', name: 'The Widow' },
  ]

  it('resolves by exact id', () => {
    const result = resolveEntityByNameOrId(roster, 'npc_2')
    expect(result).toEqual({ kind: 'found', entity: roster[1] })
  })

  it('resolves by exact name, case-insensitive', () => {
    const result = resolveEntityByNameOrId(roster, 'captain reyes')
    expect(result).toEqual({ kind: 'found', entity: roster[1] })
  })

  it('resolves a close AI-side typo via confident fuzzy match', () => {
    const result = resolveEntityByNameOrId(roster, 'Lord Kesler')
    expect(result).toEqual({ kind: 'found', entity: roster[0] })
  })

  it('does not cross-match an unrelated entity via substring containment', () => {
    // Old `contains`-mode behavior would have matched "Captain" against
    // "Captain Reyes" as a false positive; exact/fuzzy resolution must not.
    const result = resolveEntityByNameOrId(roster, 'Captain')
    expect(result.kind).toBe('not_found')
  })

  it('reports ambiguous rather than guessing when two candidates are both plausible', () => {
    const ambiguousRoster = [
      { id: 'npc_1', name: 'Manston' },
      { id: 'npc_2', name: 'Marlton' },
    ]
    // "Marston" is a single-substitution, confident-range typo away from
    // BOTH "Manston" and "Marlton" — neither is more right than the other.
    const result = resolveEntityByNameOrId(ambiguousRoster, 'Marston')
    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') {
      expect(result.candidates).toHaveLength(2)
    }
  })

  it('returns not_found for a genuinely new name', () => {
    const result = resolveEntityByNameOrId(roster, 'Someone Entirely New')
    expect(result.kind).toBe('not_found')
  })

  it('returns not_found for an empty/blank name', () => {
    expect(resolveEntityByNameOrId(roster, '   ').kind).toBe('not_found')
  })
})
