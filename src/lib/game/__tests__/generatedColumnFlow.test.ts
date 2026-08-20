// src/lib/game/__tests__/generatedColumnFlow.test.ts
//
// Checks the declared chain in generatedColumnFlow.ts against the code, in
// both directions. See that file's header for why a manifest rather than a
// heuristic.
//
// The load-bearing assertion is "every real participant is declared". Without
// it this is bookkeeping that rots; with it, adding a consumer forces you to
// open the manifest and look at the whole chain — which is the moment anyone
// would have noticed campaignCreation missing from advancementTrack's list.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import {
  GENERATED_COLUMN_FLOWS,
  findMissingRoles,
  findStaleWaivers,
  roleOf,
  evidenceOf,
  type DataFlow,
} from '../generatedColumnFlow'

const root = process.cwd()

/**
 * Source with comments removed.
 *
 * Load-bearing. advancementTrack.ts's header names all four sibling columns
 * in prose to explain the family, so an unstripped scan reports it as a
 * participant in every flow — and a check that counts prose as participation
 * would have been satisfied by the very comment describing the bug.
 */
function code(path: string): string {
  const raw = readFileSync(join(root, path), 'utf-8')
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/[^\n"']*$/gm, '')
}

const ALL_FILES = execSync(
  "find src -name '*.ts' -o -name '*.tsx' | grep -v __tests__",
  { cwd: root, maxBuffer: 64 * 1024 * 1024 }
).toString().trim().split('\n')
  // The manifest names every symbol it governs, as string literals. Counting
  // itself as a participant would make each flow permanently self-declaring.
  .filter((f) => !f.includes('generatedColumnFlow'))

/** Files whose executable code mentions the symbol. */
function realParticipants(symbol: string): string[] {
  const re = new RegExp(`\\b${symbol}\\b`)
  return ALL_FILES.filter((f) => re.test(code(f))).sort()
}

describe.each(GENERATED_COLUMN_FLOWS)('$fact', (flow: DataFlow) => {
  const declared = Object.keys(flow.roles).sort()
  const actual = realParticipants(flow.symbol)

  it('declares files that exist', () => {
    for (const f of declared) {
      expect(existsSync(join(root, f)), `${flow.fact} declares ${f}, which does not exist`).toBe(true)
    }
  })

  it('declares no file that stopped participating', () => {
    // A stale entry is not harmless: it makes the chain look complete while a
    // link is actually gone.
    const phantom = declared.filter((f) => !actual.includes(f))
    expect(
      phantom,
      `${flow.fact} declares ${phantom.join(', ')}, whose code no longer mentions ${flow.symbol}. ` +
        `Either the link was removed (fix the code) or the role moved (fix the manifest).`
    ).toEqual([])
  })

  it('fulfils each declared handoff, not merely mentioning the symbol', () => {
    // File-level participation is too weak for a handoff. When the ladder was
    // cut out of the scene-prompt request builder, that file still mentioned
    // advancementTrack elsewhere, so participation stayed true while the link
    // was gone. Where the manifest names the payload key, check for it.
    const broken: string[] = []
    for (const [file, entry] of Object.entries(flow.roles)) {
      const evidence = evidenceOf(entry)
      if (!evidence) continue
      if (!code(file).includes(evidence)) broken.push(`${file} (${roleOf(entry)}: expected \`${evidence}\`)`)
    }
    expect(
      broken,
      `${flow.fact}: declared handoff missing — ${broken.join('; ')}. The file still ` +
        `references ${flow.symbol}, so participation alone looks healthy, but the link ` +
        `itself is gone.`
    ).toEqual([])
  })

  it('declares every file that does participate', () => {
    // THE assertion. A new consumer that nobody declared is the shape of every
    // defect this manifest exists for: the field reaching some consumers and
    // not others, with nothing comparing the two lists.
    const undeclared = actual.filter((f) => !declared.includes(f))
    expect(
      undeclared,
      `${undeclared.join(', ')} use ${flow.symbol} but are not in its flow manifest. ` +
        `Add them with a role — and while you are there, check the rest of the chain reaches ` +
        `them. ${flow.why}`
    ).toEqual([])
  })
})

describe('the manifest itself', () => {
  it('covers every generated-once column on Campaign', () => {
    // A new column joining this family must join the manifest, or it gets the
    // same silent treatment the others did. Detected from the schema rather
    // than from a list here, so the two cannot drift.
    const schema = readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf-8')
    const model = schema.slice(schema.indexOf('model Campaign {'), schema.indexOf('\n}', schema.indexOf('model Campaign {')))
    const jsonColumns = [...model.matchAll(/^ {2}(\w+)\s+Json\?/gm)].map((m) => m[1])
    const declared = new Set(GENERATED_COLUMN_FLOWS.map((f) => f.symbol))
    const known = new Set([...declared, 'aiConfig', 'simulationSettings', 'heroImage'])
    const undeclared = jsonColumns.filter((c) => !known.has(c))
    expect(
      undeclared,
      `Campaign has nullable Json columns not in the flow manifest: ${undeclared.join(', ')}. ` +
        `If one is a generated-once-then-frozen fact, declare its chain; if not, add it to the ` +
        `known-exempt list with a reason.`
    ).toEqual([])
  })

  it('fills every required role, or waives it with a reason', () => {
    const missing = findMissingRoles()
    expect(
      missing.map((m) => `${m.fact}: ${m.problem}`),
      'An empty role is either a defect or a decision, and the only difference is whether ' +
        'someone wrote down which.'
    ).toEqual([])
  })

  it('keeps waivers honest', () => {
    const stale = findStaleWaivers()
    expect(stale.map((s) => `${s.fact}: ${s.problem}`)).toEqual([])
  })
})
