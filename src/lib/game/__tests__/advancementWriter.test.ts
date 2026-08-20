// src/lib/game/__tests__/advancementWriter.test.ts
//
// A rank that can be read must be a rank something can write.
//
// Character.advancementTier shipped with two readers — the full sheet and the
// in-play snapshot — and zero writers. Not one code path assigned it. So it
// was null on every character forever, tierProgress mapped null onto rung 0,
// and every character in every campaign displayed the bottom rank
// permanently, no matter what the fiction did.
//
// Nothing failed. The sheet rendered a label and a filled segment and looked
// exactly like a working feature; only the fact that it never CHANGED gave it
// away, and a feature parked at the start looks the same as a character who
// has not advanced yet.
//
// The GM could not have moved it either: the ladder appeared in exactly one
// prompt — the world-extras GENERATOR — and never reached scenePrompt, so the
// model resolving scenes was never told the ladder existed.
//
// This file pins the closed-shape rules of the writer. The structural half
// (there IS a writer, the ladder DOES reach the prompt) is in
// advancementWiring.test.ts.

import { describe, it, expect } from 'vitest'
import { parseAdvancementTrack, resolveTierKey, startingTierKey } from '../advancementTrack'

const LADDER = parseAdvancementTrack({
  tiers: [
    { key: 'normal', label: 'Normal' },
    { key: 'iron', label: 'Iron' },
    { key: 'bronze', label: 'Bronze' },
  ],
  slotGroups: [],
})!

describe('resolveTierKey keeps the ladder closed', () => {
  it('accepts a declared rung by key', () => {
    expect(resolveTierKey(LADDER, 'iron')).toBe('iron')
  })

  it('accepts a declared rung by its label, which is what the GM narrates', () => {
    expect(resolveTierKey(LADDER, 'Bronze')).toBe('bronze')
    expect(resolveTierKey(LADDER, 'BRONZE')).toBe('bronze')
  })

  it('refuses a rung this world does not have', () => {
    // The model may move a character ALONG the ladder; it may not extend it.
    // Storing an unknown key would render as "not yet ranked" forever and
    // silently undo the promotion the narration just described.
    expect(resolveTierKey(LADDER, 'diamond')).toBeNull()
    expect(resolveTierKey(LADDER, 'Grandmaster')).toBeNull()
  })

  it('refuses junk without throwing', () => {
    for (const junk of [null, undefined, 42, {}, [], '', '   ']) {
      expect(resolveTierKey(LADDER, junk)).toBeNull()
    }
  })

  it('refuses everything when the campaign has no ladder', () => {
    expect(resolveTierKey(null, 'iron')).toBeNull()
  })

  it('allows movement DOWN the ladder', () => {
    // Stripped, demoted, disgraced. Rank is not a ratchet — modelling it as
    // one would make a demotion unrepresentable and quietly discard it.
    expect(resolveTierKey(LADDER, 'normal')).toBe('normal')
  })
})

describe('startingTierKey', () => {
  it('is the lowest rung', () => {
    expect(startingTierKey(LADDER)).toBe('normal')
  })

  it('is null when the universe has no ladder', () => {
    expect(startingTierKey(null)).toBeNull()
    expect(startingTierKey(parseAdvancementTrack({ tiers: [], slotGroups: [{ key: 'e', label: 'E', capacity: 2, domain: 'd' }] }))).toBeNull()
  })

  it('is only correct at CREATION, which is why it is a separate function', () => {
    // A character being created has done nothing yet, so whatever this
    // world's bottom rung is called, they are on it — that is a fact, not an
    // inference. The same reasoning does NOT transfer to an arbitrary
    // character with a null tier, which is the conflation that made every
    // existing character render as a beginner. tierProgress deliberately does
    // not call this.
    const startsHigh = parseAdvancementTrack({
      tiers: [{ key: 'iron', label: 'Iron' }, { key: 'bronze', label: 'Bronze' }],
      slotGroups: [],
    })
    expect(startingTierKey(startsHigh)).toBe('iron')
  })
})
