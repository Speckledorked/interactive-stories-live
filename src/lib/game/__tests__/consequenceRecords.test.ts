// src/lib/game/__tests__/consequenceRecords.test.ts
//
// The defect: consequences were bare strings, so the only operations were
// "append" and "splice out". Threats accumulated forever, and the one path
// that removed one destroyed it — surviving a six-session contract became
// indistinguishable from it never happening.

import { describe, it, expect } from 'vitest'
import {
  normalizeConsequenceList,
  activeOf,
  resolvedOf,
  activeTexts,
  retireAt,
  addRecord,
} from '../consequenceRecords'

describe('reading both shapes', () => {
  it('reads a legacy string as ACTIVE', () => {
    // The only honest reading: the old format could not express resolution,
    // so everything it holds is something nobody said was over.
    expect(normalizeConsequenceList(['The Ironveil contract'])).toEqual([
      { text: 'The Ironveil contract', status: 'active' },
    ])
  })

  it('reads the new shape, preserving status and turns', () => {
    expect(
      normalizeConsequenceList([{ text: 'Hunted', status: 'resolved', since: 3, resolvedAt: 9 }])
    ).toEqual([{ text: 'Hunted', status: 'resolved', since: 3, resolvedAt: 9 }])
  })

  it('handles a mixed array, which is what a half-migrated row looks like', () => {
    const list = normalizeConsequenceList(['old', { text: 'new', status: 'resolved' }])
    expect(list.map((r) => [r.text, r.status])).toEqual([
      ['old', 'active'],
      ['new', 'resolved'],
    ])
  })

  it('drops junk rather than rendering it', () => {
    expect(normalizeConsequenceList([null, 42, '', '   ', { nope: true }])).toEqual([])
    expect(normalizeConsequenceList(null)).toEqual([])
    expect(normalizeConsequenceList('not an array')).toEqual([])
  })

  it('treats an unrecognised status as active, never as silently gone', () => {
    // Failing the other way would hide a live threat.
    expect(normalizeConsequenceList([{ text: 'x', status: 'banana' }])[0].status).toBe('active')
  })
})

describe('retiring rather than deleting', () => {
  const list = normalizeConsequenceList(['a', 'b'])

  it('marks resolved and keeps the entry', () => {
    const out = retireAt(list, 0, 12)

    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ text: 'a', status: 'resolved', resolvedAt: 12 })
    expect(out[1].status).toBe('active')
  })

  it('does not rewrite when an already-resolved entry is reported again', () => {
    const once = retireAt(list, 0, 12)
    const twice = retireAt(once, 0, 99)
    expect(twice[0].resolvedAt).toBe(12)
  })

  it('is a no-op for an index that is not there', () => {
    expect(retireAt(list, 5, 1)).toBe(list)
    expect(retireAt(list, -1, 1)).toBe(list)
  })

  it('does not mutate the input', () => {
    retireAt(list, 0, 3)
    expect(list[0].status).toBe('active')
  })
})

describe('adding', () => {
  it('stamps the turn it was incurred', () => {
    expect(addRecord([], 'Hunted by Ironveil', 7)).toEqual([
      { text: 'Hunted by Ironveil', status: 'active', since: 7 },
    ])
  })

  it('does not duplicate an active entry', () => {
    const once = addRecord([], 'Hunted', 1)
    expect(addRecord(once, 'hunted', 2)).toHaveLength(1)
  })

  it('DOES re-add something that was resolved and came back', () => {
    // A threat that ended and returned is a real event. Collapsing it into
    // the old record would claim it never stopped.
    const resolved = retireAt(addRecord([], 'Hunted', 1), 0, 4)
    const again = addRecord(resolved, 'Hunted', 9)

    expect(again).toHaveLength(2)
    expect(again[0].status).toBe('resolved')
    expect(again[1]).toEqual({ text: 'Hunted', status: 'active', since: 9 })
  })

  it('ignores empty text', () => {
    expect(addRecord([], '   ', 1)).toEqual([])
  })
})

describe('what the AI is allowed to see', () => {
  const mixed = [
    'still hunting you',
    { text: 'the contract you survived', status: 'resolved' as const, resolvedAt: 8 },
  ]

  it('feeds prompts ACTIVE entries only', () => {
    // A resolved threat that keeps reaching the prompt is a threat the
    // fiction never actually let the character out from under.
    expect(activeTexts(mixed)).toEqual(['still hunting you'])
  })

  it('splits cleanly for display', () => {
    const list = normalizeConsequenceList(mixed)
    expect(activeOf(list).map((r) => r.text)).toEqual(['still hunting you'])
    expect(resolvedOf(list).map((r) => r.text)).toEqual(['the contract you survived'])
  })
})
