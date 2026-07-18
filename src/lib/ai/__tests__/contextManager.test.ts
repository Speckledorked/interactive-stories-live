import { describe, it, expect } from 'vitest'
import { classifySceneImportance, capForPrompt } from '../contextManager'

describe('classifySceneImportance', () => {
  it('maps CRITICAL memory importance to critical regardless of text/timeline', () => {
    expect(classifySceneImportance('CRITICAL', false, 'a perfectly mundane scene')).toBe('critical')
  })

  it('maps MAJOR memory importance to important', () => {
    expect(classifySceneImportance('MAJOR', false, 'a perfectly mundane scene')).toBe('important')
  })

  it('maps NORMAL memory importance to normal', () => {
    expect(classifySceneImportance('NORMAL', true, 'death and destruction')).toBe('normal')
  })

  it('maps MINOR memory importance to normal', () => {
    expect(classifySceneImportance('MINOR', true, 'death and destruction')).toBe('normal')
  })

  it('trusts the stored memory importance over conflicting keyword signals', () => {
    // Text screams "critical" but the richer, structured signal available
    // at resolution time (character harm, clock/faction updates, scene
    // type) said otherwise — the stored value wins.
    expect(classifySceneImportance('NORMAL', false, 'a brutal death and betrayal')).toBe('normal')
  })

  describe('fallback when no memory row exists', () => {
    it('falls back to normal with no keyword or public timeline event', () => {
      expect(classifySceneImportance(undefined, false, 'a quiet chat over tea')).toBe('normal')
    })

    it('falls back to important when a public timeline event occurred', () => {
      expect(classifySceneImportance(undefined, true, 'a quiet chat over tea')).toBe('important')
    })

    it('falls back to critical on a critical keyword, overriding the timeline-event signal', () => {
      expect(classifySceneImportance(undefined, true, 'and then came the betrayal')).toBe('critical')
    })

    it('falls back to critical on a critical keyword even with no timeline event', () => {
      expect(classifySceneImportance(undefined, false, 'the hero was killed')).toBe('critical')
    })
  })
})

// Depth-hardening #37 (see README): capForPrompt is the hard backstop on
// unbounded prompt/context growth in a maximally active campaign.
describe('capForPrompt', () => {
  it('returns the list completely unchanged when under the cap', () => {
    const items = [{ id: 'a', p: 1 }, { id: 'b', p: 3 }, { id: 'c', p: 2 }]
    const result = capForPrompt(items, 5, i => i.p)
    expect(result).toBe(items) // same reference — no reordering, no copy
  })

  it('keeps exactly maxCount items when over the cap', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, p: i }))
    const result = capForPrompt(items, 5, i => i.p)
    expect(result).toHaveLength(5)
  })

  it('keeps the highest-priority items, not an arbitrary slice', () => {
    const items = [
      { id: 'low', p: 1 },
      { id: 'high', p: 100 },
      { id: 'mid', p: 50 },
    ]
    const result = capForPrompt(items, 2, i => i.p)
    expect(result.map(i => i.id)).toEqual(['high', 'mid'])
  })

  it('does not mutate the input array', () => {
    const items = [{ id: 'a', p: 1 }, { id: 'b', p: 2 }, { id: 'c', p: 3 }]
    const copy = [...items]
    capForPrompt(items, 1, i => i.p)
    expect(items).toEqual(copy)
  })

  it('handles an empty list', () => {
    expect(capForPrompt([], 5, (i: any) => i.p)).toEqual([])
  })

  it('handles exactly-at-the-cap with no reordering', () => {
    const items = [{ id: 'a', p: 3 }, { id: 'b', p: 1 }, { id: 'c', p: 2 }]
    const result = capForPrompt(items, 3, i => i.p)
    expect(result).toBe(items)
  })
})
