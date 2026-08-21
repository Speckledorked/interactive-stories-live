// src/lib/game/__tests__/advancementWiring.test.ts
//
// The chain that has to be unbroken for a rank to ever change.
//
// advancementTier shipped with every link missing but one, and the whole
// thing still typechecked, still passed 4,600 tests, and still rendered
// something plausible on screen. The links:
//
//   generated -> stored on the campaign   (was broken: creation never wrote it)
//   stored    -> shown to the GM          (was broken: only the GENERATOR prompt
//                                          mentioned the ladder; scenePrompt
//                                          never did)
//   GM        -> a response channel       (was broken: no schema field)
//   channel   -> the character row        (was broken: zero writers)
//   row       -> the sheet                (this link worked, which is exactly
//                                          why it looked fine)
//
// Every broken link failed the same way: silently, into a value that is
// legitimate elsewhere. null means "this universe has no ladder", so a null
// from a missing write is indistinguishable from an honest answer, and a
// rendered bottom rung is indistinguishable from a character who has not
// advanced. Nothing in a unit test can see a link that was never built.
//
// So this is structural, and it checks the LINKS rather than the behaviour.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = process.cwd()
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf-8')

const CREATION = read('src', 'lib', 'game', 'characterCreation.ts')
const SCENE_PROMPT = read('src', 'lib', 'ai', 'scenePrompt.ts')
const REQUEST = read('src', 'lib', 'ai', 'sceneResolutionRequest.ts')
const SCHEMA = read('src', 'lib', 'ai', 'schema.ts')
const UPDATER = read('src', 'lib', 'game', 'worldUpdaters', 'characters.ts')

describe('the rank a character holds can actually change', () => {
  it('something writes Character.advancementTier', () => {
    // The defect in one line. Two readers, zero writers, and a fallback that
    // disguised it.
    expect(UPDATER).toMatch(/updateData\.advancementTier\s*=/)
  })

  it('the writer validates against the campaign ladder rather than storing raw model text', () => {
    // Closed shape. An undeclared rung must be refused, not persisted — a
    // stored unknown key reads as "not yet ranked" and silently undoes the
    // promotion the fiction narrated.
    const block = UPDATER.slice(UPDATER.indexOf('advancement_tier'), UPDATER.indexOf('// Corruption marks'))
    expect(block).toMatch(/resolveTierKey\(/)
    expect(block).toMatch(/gateRefusals\.push/)
  })

  it('the response schema has a channel for it', () => {
    expect(SCHEMA).toMatch(/advancement_tier:\s*z\.string\(\)/)
  })

  it('the GM is actually told the ladder exists', () => {
    // This link is the one nobody would think to check: the ladder was in the
    // world-extras GENERATOR prompt, so it looked "in the prompt" from a
    // grep, while the model resolving scenes never saw a word of it.
    expect(SCENE_PROMPT).toMatch(/<advancement>/)
    expect(SCENE_PROMPT).toMatch(/advancement_tier/)
  })

  it('the request builder populates the ladder and each character position', () => {
    expect(REQUEST).toMatch(/advancement_track:/)
    expect(REQUEST).toMatch(/advancement_status/)
  })

  it('a new character defaults to the bottom rung, and may claim any declared one', () => {
    // The default is still the lowest rung — a brand-new nobody needs no
    // input. But an ESTABLISHED character is equally legitimate (an Iron
    // adventurer with essences already bound, a Diamond, a half-
    // transcendent), so the body may claim a rung. This test's previous
    // version asserted the opposite ("a client-supplied tier would let
    // anyone start at the top" — which is now the point, not the threat):
    // the third test this week found encoding a policy as an invariant.
    expect(CREATION).toMatch(/startingTierKey\(/)
    expect(CREATION).toMatch(/advancementTier,/)
    expect(CREATION).toMatch(/body\.advancementTier/)
  })

  it('a claimed rung is resolved against the campaign ladder, never stored raw', () => {
    // The security property that SURVIVES the policy change: nothing
    // arbitrary is ever written. You may claim Diamond; you may not claim
    // "Cosmic Overlord". resolveTierKey returns null for an undeclared rung
    // and the fallback places the character at the bottom.
    const seed = CREATION.slice(CREATION.indexOf('const campaignTrack'), CREATION.indexOf('prisma.character.create'))
    expect(seed).toMatch(/prisma\.campaign\.findUnique/)
    expect(seed).toMatch(/resolveTierKey\(track, body\.advancementTier\)/)
    // The raw body value must never be a fallback of its own.
    expect(seed).not.toMatch(/\?\?\s*body\.advancementTier/)
  })

  it('does not re-infer a starting rung at render time', () => {
    // tierProgress must never call startingTierKey. Placing a NEW character
    // on the bottom rung is a fact; inferring it for any character whose tier
    // happens to be null is the original defect.
    const helpers = read('src', 'lib', 'game', 'advancementTrack.ts')
    const fn = helpers.slice(helpers.indexOf('export function tierProgress'), helpers.indexOf('export function startingTierKey'))
    expect(fn).not.toMatch(/startingTierKey/)
    expect(fn).toMatch(/unplaced: true/)
  })
})
