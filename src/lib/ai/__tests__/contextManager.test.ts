import { describe, it, expect } from 'vitest'
import { classifySceneImportance, capForPrompt, clampPromptStrings, MAX_PROMPT_STRING_CHARS } from '../contextManager'

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

// ---------------------------------------------------------------------------
// clampPromptStrings (#67)
// ---------------------------------------------------------------------------
// capForPrompt bounds how MANY entities reach the prompt; this bounds how
// large each one is. Without it "15 NPCs" is a ceiling on count and no
// ceiling at all on tokens.

describe('clampPromptStrings (#67)', () => {
  it('leaves short strings untouched', () => {
    expect(clampPromptStrings('a short description')).toBe('a short description')
  })

  it('truncates an oversized string and marks it', () => {
    const long = 'word '.repeat(1000).trim()
    const result = clampPromptStrings(long) as unknown as string
    expect(result.length).toBeLessThanOrEqual(MAX_PROMPT_STRING_CHARS)
    expect(result).toContain('… (truncated)')
  })

  it('walks nested objects and arrays', () => {
    const long = 'x'.repeat(5000)
    const summary = {
      turn_number: 12,
      characters: [{ name: 'Vera', backstory: long, harm: 3 }],
      npcs: [{ name: 'Duke', description: long, goals: long }],
    }
    const result = clampPromptStrings(summary)
    expect(result.turn_number).toBe(12)
    expect(result.characters[0].name).toBe('Vera')
    expect(result.characters[0].harm).toBe(3)
    expect(result.characters[0].backstory.length).toBeLessThanOrEqual(MAX_PROMPT_STRING_CHARS)
    expect(result.npcs[0].description.length).toBeLessThanOrEqual(MAX_PROMPT_STRING_CHARS)
    expect(result.npcs[0].goals.length).toBeLessThanOrEqual(MAX_PROMPT_STRING_CHARS)
  })

  it('bounds total payload growth driven by field length, not entity count', () => {
    const long = 'y'.repeat(20_000)
    const fifteenNpcs = Array.from({ length: 15 }, (_, i) => ({
      name: `NPC ${i}`,
      description: long,
      goals: long,
    }))
    const before = JSON.stringify(fifteenNpcs).length
    const after = JSON.stringify(clampPromptStrings(fifteenNpcs)).length
    expect(before).toBeGreaterThan(500_000)
    expect(after).toBeLessThan(30_000)
  })

  it('passes non-strings through untouched, including null and numbers', () => {
    const input = { a: null, b: 42, c: true, d: undefined }
    expect(clampPromptStrings(input)).toEqual({ a: null, b: 42, c: true, d: undefined })
  })

  it('does not rebuild Date instances into plain objects', () => {
    const date = new Date('2026-01-01T00:00:00Z')
    const result = clampPromptStrings({ createdAt: date })
    expect(result.createdAt).toBeInstanceOf(Date)
    expect(result.createdAt.getTime()).toBe(date.getTime())
  })

  it('respects an explicit limit override', () => {
    const result = clampPromptStrings('abcdefghij'.repeat(10), 40) as unknown as string
    expect(result.length).toBeLessThanOrEqual(40)
  })
})
