// src/lib/game/__tests__/textAppend.test.ts
// Bounded append for the free-text fields the AI extends every turn (#46,
// #70). The invariant that matters: these fields are re-read into the AI
// prompt on every relevant scene, so growth has to have a ceiling that
// exists independently of anyone remembering to prune.

import { describe, it, expect } from 'vitest'
import {
  appendBounded,
  appendBoundedProse,
  boundAdvancementEntries,
  truncateAtWord,
  TRIM_MARKER,
  GM_NOTES_BOUNDS,
  QUEST_PROGRESS_BOUNDS,
  MAX_ADVANCEMENT_LOG_ENTRIES,
  MAX_CHARACTER_DESCRIPTION_CHARS,
} from '../textAppend'

describe('appendBounded', () => {
  const bounds = { separator: '\n\n', maxEntries: 3, maxChars: 10_000 }

  it('appends to an empty field without a leading separator', () => {
    expect(appendBounded(null, 'first note', bounds)).toBe('first note')
    expect(appendBounded('', 'first note', bounds)).toBe('first note')
    expect(appendBounded(undefined, 'first note', bounds)).toBe('first note')
  })

  it('appends while under the entry cap, preserving order', () => {
    const result = appendBounded('a\n\nb', 'c', bounds)
    expect(result).toBe('a\n\nb\n\nc')
  })

  it('drops the oldest entries once the entry cap is exceeded', () => {
    const result = appendBounded('a\n\nb\n\nc', 'd', bounds)
    // Keeps the newest 3, marks that something was dropped.
    expect(result).toBe(`${TRIM_MARKER}\n\nb\n\nc\n\nd`)
    expect(result).not.toContain('a\n\n')
  })

  it('never stacks trim markers across repeated trims', () => {
    let value = 'a\n\nb\n\nc'
    for (const next of ['d', 'e', 'f', 'g']) {
      value = appendBounded(value, next, bounds)
    }
    const markerCount = value.split(TRIM_MARKER).length - 1
    expect(markerCount).toBe(1)
    expect(value).toBe(`${TRIM_MARKER}\n\ne\n\nf\n\ng`)
  })

  it('enforces the character ceiling by dropping whole entries, newest kept', () => {
    const long = 'x'.repeat(400)
    const result = appendBounded(`${long}\n\n${long}`, 'tail entry', {
      separator: '\n\n',
      maxEntries: 10,
      maxChars: 500,
    })
    expect(result.length).toBeLessThanOrEqual(500)
    expect(result).toContain('tail entry')
    expect(result).toContain(TRIM_MARKER)
  })

  it('truncates a single oversized entry at a word boundary rather than dropping it', () => {
    const oversized = 'word '.repeat(300).trim()
    const result = appendBounded(null, oversized, { separator: '\n\n', maxEntries: 5, maxChars: 100 })
    expect(result.length).toBeLessThanOrEqual(100)
    expect(result).toContain(TRIM_MARKER)
    // Word boundary respected — no dangling partial token at the end.
    expect(result.endsWith('wor')).toBe(false)
  })

  it('is a no-op on an empty addition', () => {
    expect(appendBounded('a\n\nb', '   ', bounds)).toBe('a\n\nb')
  })

  it('ignores blank entries left by stray separators', () => {
    expect(appendBounded('a\n\n\n\nb', 'c', bounds)).toBe('a\n\nb\n\nc')
  })

  it('keeps quest progress lines newline-separated under its own bounds', () => {
    let log: string | null = null
    for (let turn = 1; turn <= 30; turn++) {
      log = appendBounded(log, `Turn ${turn}: did a thing`, QUEST_PROGRESS_BOUNDS)
    }
    const lines = log!.split('\n').filter(l => l !== TRIM_MARKER)
    expect(lines).toHaveLength(QUEST_PROGRESS_BOUNDS.maxEntries)
    // The newest beat survives; the oldest is gone.
    expect(log).toContain('Turn 30: did a thing')
    expect(log).not.toContain('Turn 1: did a thing')
  })

  it('bounds GM notes over a long campaign instead of growing forever', () => {
    let notes: string | null = null
    for (let turn = 1; turn <= 200; turn++) {
      notes = appendBounded(notes, `Turn ${turn}: the situation developed somewhat.`, GM_NOTES_BOUNDS)
    }
    expect(notes!.length).toBeLessThanOrEqual(GM_NOTES_BOUNDS.maxChars)
    expect(notes).toContain('Turn 200')
  })
})

describe('appendBoundedProse', () => {
  it('joins continuous prose with a space', () => {
    expect(appendBoundedProse('She has a scar.', 'Her hair is greying.', 500))
      .toBe('She has a scar. Her hair is greying.')
  })

  it('handles an empty starting value', () => {
    expect(appendBoundedProse(null, 'A tall woman.', 500)).toBe('A tall woman.')
  })

  it('keeps the newest prose when over the ceiling', () => {
    const old = 'old '.repeat(200).trim()
    const result = appendBoundedProse(old, 'freshly acquired scar over the left eye', 200)
    expect(result.length).toBeLessThanOrEqual(200)
    expect(result).toContain('freshly acquired scar over the left eye')
    expect(result).toContain(TRIM_MARKER)
  })

  it('does not accumulate markers when trimmed repeatedly', () => {
    let value: string | null = null
    for (let i = 0; i < 50; i++) {
      value = appendBoundedProse(value, `change number ${i} to their appearance`, 200)
    }
    expect(value!.split(TRIM_MARKER).length - 1).toBe(1)
    expect(value!.length).toBeLessThanOrEqual(200)
  })

  it('stays within the character-description budget over a long campaign', () => {
    let appearance: string | null = null
    for (let i = 0; i < 300; i++) {
      appearance = appendBoundedProse(appearance, `Scar ${i} appeared.`, MAX_CHARACTER_DESCRIPTION_CHARS)
    }
    expect(appearance!.length).toBeLessThanOrEqual(MAX_CHARACTER_DESCRIPTION_CHARS)
    expect(appearance).toContain('Scar 299')
  })
})

describe('truncateAtWord', () => {
  it('returns short text unchanged', () => {
    expect(truncateAtWord('short', 100)).toBe('short')
  })

  it('backs up to a word boundary', () => {
    expect(truncateAtWord('alpha beta gamma delta', 14)).toBe('alpha beta')
  })

  it('hard-cuts a single long token with no boundary to back up to', () => {
    const token = 'x'.repeat(50)
    expect(truncateAtWord(token, 10)).toBe('x'.repeat(10))
  })
})

describe('boundAdvancementEntries', () => {
  it('leaves a short log untouched', () => {
    const entries = [1, 2, 3]
    expect(boundAdvancementEntries(entries)).toBe(entries)
  })

  it('keeps the NEWEST entries when over the cap', () => {
    const entries = Array.from({ length: MAX_ADVANCEMENT_LOG_ENTRIES + 10 }, (_, i) => i)
    const bounded = boundAdvancementEntries(entries)
    expect(bounded).toHaveLength(MAX_ADVANCEMENT_LOG_ENTRIES)
    // Newest-kept is load-bearing: countGrantsInArc reads this same array to
    // enforce the per-arc grant budget, so trimming must never hide a recent
    // grant and hand a character free budget.
    expect(bounded[bounded.length - 1]).toBe(entries[entries.length - 1])
    expect(bounded[0]).toBe(10)
  })
})
