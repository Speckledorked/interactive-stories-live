// src/lib/lore/__tests__/reseedWorld.test.ts
// Fresh-vs-live faction merge planning for lore reseeds.

import { describe, it, expect } from 'vitest'
import { planFactionMerge } from '../reseedWorld'

describe('planFactionMerge', () => {
  const existing = ['The Ashveil Syndicate', 'House Venture']
  const generated = ['House Venture', 'House Elariel', 'The Steel Ministry']

  it('live mode: adds unknown canon factions, retires nothing', () => {
    const plan = planFactionMerge(existing, generated, false)
    expect(plan.toAdd).toEqual(['House Elariel', 'The Steel Ministry'])
    expect(plan.toRetire).toEqual([])
  })

  it('fresh mode: also retires non-canon leftovers', () => {
    const plan = planFactionMerge(existing, generated, true)
    expect(plan.toAdd).toEqual(['House Elariel', 'The Steel Ministry'])
    expect(plan.toRetire).toEqual(['The Ashveil Syndicate'])
  })

  it('matches names case-insensitively (canon name keeps the existing row)', () => {
    const plan = planFactionMerge(['house venture'], ['House Venture'], true)
    expect(plan.toAdd).toEqual([])
    expect(plan.toRetire).toEqual([])
  })

  it('handles empty inputs', () => {
    expect(planFactionMerge([], generated, true).toAdd).toHaveLength(3)
    expect(planFactionMerge(existing, [], true).toRetire).toEqual(existing)
    expect(planFactionMerge(existing, [], false).toRetire).toEqual([])
  })
})
