// src/lib/__tests__/wikiCategoryGrouping.test.ts

import { describe, it, expect } from 'vitest'
import { formatCategoryLabel, groupWikiEntriesByCategory, UNCATEGORIZED_LABEL } from '../wikiCategoryGrouping'

describe('formatCategoryLabel', () => {
  it('capitalizes a plain lowercase tag', () => {
    expect(formatCategoryLabel('settlement')).toBe('Settlement')
  })

  it('turns underscores/hyphens into spaces', () => {
    expect(formatCategoryLabel('secret_society')).toBe('Secret society')
    expect(formatCategoryLabel('open-gates')).toBe('Open gates')
  })

  it('leaves an already-capitalized multi-word tag alone', () => {
    expect(formatCategoryLabel('Silver Hand')).toBe('Silver Hand')
  })

  it('falls back to Uncategorized for an empty/whitespace tag', () => {
    expect(formatCategoryLabel('')).toBe(UNCATEGORIZED_LABEL)
    expect(formatCategoryLabel('   ')).toBe(UNCATEGORIZED_LABEL)
  })
})

describe('groupWikiEntriesByCategory', () => {
  it('groups entries by their first tag', () => {
    const entries = [
      { id: 'a', tags: ['settlement'] },
      { id: 'b', tags: ['wilderness'] },
      { id: 'c', tags: ['settlement'] },
    ]
    const groups = groupWikiEntriesByCategory(entries, 'LOCATION')
    expect(groups.map((g) => g.label)).toEqual(['Settlement', 'Wilderness'])
    expect(groups[0].entries.map((e: any) => e.id)).toEqual(['a', 'c'])
  })

  it('treats a missing or empty tags array as Uncategorized, sorted last', () => {
    const entries = [
      { id: 'a', tags: ['wilderness'] },
      { id: 'b', tags: [] },
      { id: 'c', tags: undefined },
    ]
    const groups = groupWikiEntriesByCategory(entries, 'LOCATION')
    expect(groups.map((g) => g.label)).toEqual(['Wilderness', UNCATEGORIZED_LABEL])
    expect(groups[1].entries.map((e: any) => e.id)).toEqual(['b', 'c'])
  })

  it('is case-insensitive when bucketing but keeps the first-seen casing as the label', () => {
    const entries = [
      { id: 'a', tags: ['Settlement'] },
      { id: 'b', tags: ['settlement'] },
    ]
    const groups = groupWikiEntriesByCategory(entries, 'LOCATION')
    expect(groups).toHaveLength(1)
    expect(groups[0].entries).toHaveLength(2)
  })

  it('orders quest groups by status (active, completed, failed, abandoned), not alphabetically', () => {
    const entries = [
      { id: 'a', tags: ['abandoned'] },
      { id: 'b', tags: ['completed'] },
      { id: 'c', tags: ['active'] },
      { id: 'd', tags: ['failed'] },
    ]
    const groups = groupWikiEntriesByCategory(entries, 'QUEST')
    expect(groups.map((g) => g.label)).toEqual(['Active', 'Completed', 'Failed', 'Abandoned'])
  })

  it('sorts non-quest groups alphabetically', () => {
    const entries = [
      { id: 'a', tags: ['Zealots'] },
      { id: 'b', tags: ['Merchants Guild'] },
      { id: 'c', tags: ['Astral Survey Office'] },
    ]
    const groups = groupWikiEntriesByCategory(entries, 'NPC')
    expect(groups.map((g) => g.label)).toEqual(['Astral Survey Office', 'Merchants Guild', 'Zealots'])
  })

  it('returns one group with everything when every entry shares a tag', () => {
    const entries = [
      { id: 'a', tags: ['Military'] },
      { id: 'b', tags: ['Military'] },
    ]
    const groups = groupWikiEntriesByCategory(entries, 'FACTION')
    expect(groups).toHaveLength(1)
    expect(groups[0].entries).toHaveLength(2)
  })

  it('returns an empty array for an empty entry list', () => {
    expect(groupWikiEntriesByCategory([], 'NPC')).toEqual([])
  })
})
