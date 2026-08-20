// src/lib/ai/__tests__/promptSchemaCoherence.test.ts
//
// If the prompt asks the model for a field the schema does not accept, the
// instruction is dead and nobody finds out.
//
// The response is parsed by Zod. An undeclared key is STRIPPED — not
// rejected, not logged, stripped — so the model does exactly what it was
// told, the engine receives nothing, and the narration describes something
// that never happened to the database. That is the same silent-into-a-legal-
// value shape as every defect found this week:
//
//   - advancementTrack generated and never persisted (null is a real answer)
//   - advancementTier read by two surfaces and written by none (null again)
//   - the snapshot modal reading a ladder its route never sent (undefined)
//
// Here the legal value is "the model chose not to report anything", which is
// a perfectly ordinary outcome on any given exchange. So a permanently dead
// channel is indistinguishable from a quiet scene, and the only way to notice
// is to compare the two artifacts directly.
//
// ## Scope, stated plainly
//
// This checks ONE direction: a JSON key the prompt shows the model must exist
// in the schema. The reverse — a schema field no prompt mentions — was built
// and NOT shipped, for a reason worth recording. Across all of src/lib/ai it
// reports zero, which sounds good and is actually too loose to be worth
// having: a field mentioned in ANY prompt passes, including a field mentioned
// only in the world-generation prompt while the scene prompt never says a
// word about it. That is exactly how the rank ladder came to exist in the
// generator prompt and never reach the GM resolving scenes. Catching it needs
// each schema subtree bound to the specific prompt that drives it, which is a
// real mapping, not a regex. Per-file it reports 27 fields, most of them
// request-side or handled in another prompt, and a 27-line list nobody
// triages is a suppression file.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = process.cwd()
const schema = readFileSync(join(root, 'src', 'lib', 'ai', 'schema.ts'), 'utf-8')

/**
 * Every field name the response schema declares.
 *
 * Deliberately matches `name:` followed by anything, not `name: z.`. The
 * first draft required `z.` and produced nine false positives — every field
 * built from a helper (`boundedDelta(...)`) or a named sub-schema
 * (`SceneProgressSchema`) looked undeclared.
 */
const schemaFields = new Set([
  ...schema.matchAll(/^\s*([a-zA-Z][a-zA-Z0-9_]*):\s*\S/gm),
].map((m) => m[1]))

/** Bare string literals in the schema — enum members and literal unions. */
const schemaLiterals = new Set([...schema.matchAll(/'([a-z][a-z0-9_]*)'/g)].map((m) => m[1]))

const PROMPTS = ['scenePrompt.ts']

describe('the GM prompt only asks for fields the schema accepts', () => {
  it('reads both sides', () => {
    expect(schemaFields.size).toBeGreaterThan(100)
    expect(schemaFields.has('consequences_add')).toBe(true)
    expect(schemaFields.has('advancement_tier')).toBe(true)
  })

  it.each(PROMPTS)('%s asks for nothing Zod would silently strip', (file) => {
    const src = readFileSync(join(root, 'src', 'lib', 'ai', file), 'utf-8')
    // JSON keys the prompt shows the model: `"some_key":` inside the template
    // literals, including escaped quotes in nested examples.
    const asked = new Set([...src.matchAll(/\\?"([a-z][a-z0-9_]{2,})\\?"\s*:/g)].map((m) => m[1]))
    const stripped = [...asked].filter((k) => !schemaFields.has(k) && !schemaLiterals.has(k)).sort()
    expect(
      stripped,
      `${file} instructs the model to report ${stripped.join(', ')}, which the response ` +
        `schema does not declare. Zod strips undeclared keys silently, so the model will ` +
        `comply, the engine will receive nothing, and the narration will describe a change ` +
        `that never reached the database.`
    ).toEqual([])
  })
})
