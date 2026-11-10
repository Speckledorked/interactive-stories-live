// src/lib/analytics/__tests__/creationPath.test.ts
// #508: the one field in the character-creation body that is believed
// rather than validated, and the reason that is safe.

import { describe, it, expect } from 'vitest'
import { normalizeCreationPath } from '../creationPath'

describe('normalizeCreationPath', () => {
  it('accepts the two real paths', () => {
    expect(normalizeCreationPath('quick')).toBe('quick')
    expect(normalizeCreationPath('full')).toBe('full')
  })

  it('calls anything else unspecified rather than guessing', () => {
    // A character made before this shipped, or by a client that does not
    // send it, is genuinely unknown. Defaulting to 'full' would invent a
    // measurement — the dashboard would show wizard use that never
    // happened, which is worse than an honest gap.
    for (const value of [undefined, null, '', 'Quick', 'wizard', 7, {}, [], true]) {
      expect(normalizeCreationPath(value), `${JSON.stringify(value)}`).toBe('unspecified')
    }
  })

  it('never returns a value outside the closed set', () => {
    // What lets the dashboard group on it without sanitising at read time.
    const allowed = new Set(['quick', 'full', 'unspecified'])
    for (const value of ['quick', 'full', 'nonsense', undefined, 0]) {
      expect(allowed.has(normalizeCreationPath(value))).toBe(true)
    }
  })
})
