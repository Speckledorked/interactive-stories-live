// src/lib/lore/__tests__/loreDigest.test.ts
// Lore digest sampling: even coverage of the corpus and a hard character
// budget — the pure halves of buildLoreDigest.

import { describe, it, expect } from 'vitest'
import {
  evenlySpacedIndices,
  formatLoreDigest,
  DIGEST_MAX_CHARS,
} from '../loreDigest'

describe('evenlySpacedIndices', () => {
  it('returns everything when the corpus fits', () => {
    expect(evenlySpacedIndices(3, 24)).toEqual([0, 1, 2])
    expect(evenlySpacedIndices(5, 5)).toEqual([0, 1, 2, 3, 4])
  })

  it('spreads picks across a large corpus instead of taking the head', () => {
    const picks = evenlySpacedIndices(1000, 4)
    expect(picks).toEqual([0, 250, 500, 750])
  })

  it('is sorted, deduplicated, and in range', () => {
    const picks = evenlySpacedIndices(7, 5)
    expect(picks).toEqual([...new Set(picks)].sort((a, b) => a - b))
    expect(picks.every(i => i >= 0 && i < 7)).toBe(true)
  })

  it('handles empty and degenerate inputs', () => {
    expect(evenlySpacedIndices(0, 10)).toEqual([])
    expect(evenlySpacedIndices(10, 0)).toEqual([])
    expect(evenlySpacedIndices(-1, 3)).toEqual([])
  })
})

describe('formatLoreDigest', () => {
  const entry = (title: string, size: number) => ({
    title,
    content: 'x'.repeat(size),
  })

  it('renders titled blocks', () => {
    const digest = formatLoreDigest([
      { title: 'House Venture', content: 'A great house of the Final Empire.' },
      { title: 'Allomancy', content: 'Metal-fueled magic.' },
    ])
    expect(digest).toContain('### House Venture')
    expect(digest).toContain('### Allomancy')
    expect(digest).toContain('Metal-fueled magic.')
  })

  it('truncates each entry to its share of the budget', () => {
    const digest = formatLoreDigest([entry('Big', 50000), entry('Second', 100)], 2000)
    // Big gets ~half the budget, not all 50k chars
    expect(digest.length).toBeLessThanOrEqual(2000 + 100)
    expect(digest).toContain('…')
    expect(digest).toContain('### Second')
  })

  it('never exceeds the overall budget by more than one block', () => {
    const entries = Array.from({ length: 40 }, (_, i) => entry(`E${i}`, 1000))
    const digest = formatLoreDigest(entries, DIGEST_MAX_CHARS)
    expect(digest.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS + 1000)
  })

  it('returns empty string for no entries', () => {
    expect(formatLoreDigest([])).toBe('')
  })
})
