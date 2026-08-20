// src/lib/game/__tests__/generatedColumnFlow.test.ts
//
// The cheap, pure half of the generated-column flow checks: the manifest's
// internal consistency and its coverage of the schema family. The expensive
// half — verifying the manifest against the CODE (participation, evidence,
// role fulfillment) — lives in scripts/check-column-wiring.ts, which builds
// one TypeScript program and serves both this manifest and the schema-wide
// wiring gates from the same symbol-level analysis.
//
// This file used to do the code half itself, with regexes: a 484-file scan, a
// hand-rolled comment stripper (advancementTrack.ts's header names all four
// sibling columns in prose, so an unstripped scan counted the comment
// describing the bug as participation in it), and string `evidence` that
// embedded formatting. All of that is superseded by the engine — see
// scripts/columnFlowAnalysis.ts's header for why regexes lost.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  GENERATED_COLUMN_FLOWS,
  findMissingRoles,
  findStaleWaivers,
} from '../generatedColumnFlow'

const root = process.cwd()

describe('the manifest itself', () => {
  it('declares files that exist', () => {
    for (const flow of GENERATED_COLUMN_FLOWS) {
      for (const f of Object.keys(flow.roles)) {
        expect(existsSync(join(root, f)), `${flow.fact} declares ${f}, which does not exist`).toBe(true)
      }
    }
  })

  it('covers every generated-once column on Campaign', () => {
    // A new column joining this family must join the manifest, or it gets the
    // same silent treatment the others did. Detected from the schema rather
    // than from a list here, so the two cannot drift.
    const schema = readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf-8')
    const start = schema.indexOf('model Campaign {')
    const model = schema.slice(start, schema.indexOf('\n}', start))
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
    expect(
      findMissingRoles().map((m) => `${m.fact}: ${m.problem}`),
      'An empty role is either a defect or a decision, and the only difference is whether ' +
        'someone wrote down which.'
    ).toEqual([])
  })

  it('keeps waivers honest', () => {
    expect(findStaleWaivers().map((s) => `${s.fact}: ${s.problem}`)).toEqual([])
  })
})
