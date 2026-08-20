// src/lib/game/__tests__/worldExtrasPersistence.test.ts
//
// A generated field with a column waiting for it must actually be written.
//
// `advancementTrack` shipped complete in every respect but one. The
// generator produced it, the migration added Campaign.advancementTrack, the
// parser, the progress helpers and the sheet were all wired and tested — and
// campaignCreation.ts, the only path that creates a campaign, never listed
// it in the `campaign.create` data block. Every campaign therefore had a
// null column and the sheet rendered nothing.
//
// Nothing failed. That is the whole problem. For this family of columns null
// is a MEANINGFUL value — "this universe has no such concept" — so a column
// that is null because nobody wrote it is indistinguishable from a column
// that is null because the generator honestly said no. The unit tests passed
// (they test the parser, given input), the route tests passed (they test the
// backfill, which was reachable in isolation), and the sheet's own tests
// passed (they render whatever track they are handed). The gap sat in the
// wiring between two correct halves, which is where every defect this week
// has been.
//
// So the check is structural: intersect what the generator RETURNS with what
// Campaign can STORE, and require the creation path to write each one. A new
// generated field with a matching column is caught the day it is added,
// rather than the day someone notices an empty panel.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = process.cwd()
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf-8')

/** Field names declared on the GeneratedWorldExtras interface. */
function generatedFields(): string[] {
  const src = read('src', 'lib', 'ai', 'worldExtras.ts')
  const start = src.indexOf('export interface GeneratedWorldExtras')
  expect(start).toBeGreaterThan(-1)
  const block = src.slice(start, src.indexOf('\n}', start))
  // `name: Type` at one indent level, ignoring comment lines.
  return [...block.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1])
}

/**
 * SCALAR field names on the Campaign model in schema.prisma.
 *
 * Relations are excluded deliberately. `archetypes` is generated AND named
 * on the model, but as a `CampaignArchetype[]` relation — it is stored by
 * creating rows in another table, not by writing a column, so requiring
 * creation to "write" it would be wrong. A scalar list (`String[]`) is still
 * a column and stays in scope; only model-typed fields drop out.
 */
function campaignColumns(): string[] {
  const src = read('prisma', 'schema.prisma')
  const start = src.indexOf('model Campaign {')
  expect(start).toBeGreaterThan(-1)
  const block = src.slice(start, src.indexOf('\n}', start))
  const SCALARS = new Set([
    'String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal', 'DateTime', 'Json', 'Bytes',
  ])
  return [...block.matchAll(/^ {2}(\w+)\s+([\w]+)(\[\])?(\?)?/gm)]
    .filter((m) => SCALARS.has(m[2]) || m[2].startsWith('Unsupported'))
    .map((m) => m[1])
}

/** The `data: { ... }` object of the campaign.create call in creation. */
function creationDataBlock(): string {
  const src = read('src', 'lib', 'game', 'campaignCreation.ts')
  const start = src.indexOf('tx.campaign.create(')
  expect(start).toBeGreaterThan(-1)
  // Up to the close of the create call — generous, since anything written
  // inside it counts and nothing outside it does.
  return src.slice(start, src.indexOf('\n    })', start))
}

describe('generated world extras reach the Campaign row (#459 follow-up)', () => {
  const generated = generatedFields()
  const columns = new Set(campaignColumns())
  const overlap = generated.filter((f) => columns.has(f))

  it('reads both sides', () => {
    // Neither parser silently matching nothing is what makes the assertion
    // below mean anything.
    expect(generated).toContain('archetypes')
    expect(generated).toContain('advancementTrack')
    expect(columns.has('corruptionTheme')).toBe(true)
    // The relation filter must not swallow real columns.
    expect(columns.has('title')).toBe(true)
    // ...and must exclude relations, or `archetypes` reappears as a column
    // creation is required to write, which it can never do.
    expect(columns.has('archetypes')).toBe(false)
  })

  it('finds the fields that are both generated and storable on Campaign', () => {
    // archetypes/npcs/locations are their own tables, so they are correctly
    // absent here; this is the set that lands on the Campaign row itself.
    expect(overlap.sort()).toEqual(['advancementTrack', 'corruptionTheme'])
  })

  it('writes every one of them at campaign creation', () => {
    const data = creationDataBlock()
    for (const field of overlap) {
      expect(
        new RegExp(`\\b${field}:`).test(data),
        `campaignCreation.ts creates a Campaign without writing generated field "${field}". ` +
          `The column exists and the generator fills it, so it will be null forever — and ` +
          `null is a meaningful value for this family of columns, so nothing will look broken.`
      ).toBe(true)
    }
  })
})

describe('the world-extras backfill can reach every field it backfills', () => {
  const src = read('src', 'app', 'api', 'campaigns', '[id]', 'world-extras', 'route.ts')

  it('decides "nothing left to do" from the same list it fills', () => {
    // The original guard hardcoded `existingArchetypes > 0 &&
    // campaign.corruptionTheme` and short-circuited before the advancement
    // backfill below it, so a campaign with those two could never acquire a
    // track — the exact lock-out this route exists to undo.
    const guard = src.slice(src.indexOf('const missing = ['), src.indexOf('if (missing.length === 0)'))
    expect(guard).toMatch(/existingArchetypes === 0/)
    expect(guard).toMatch(/!campaign\.corruptionTheme/)
    expect(guard).toMatch(/!campaign\.advancementTrack/)
  })

  it('puts the early return before none of the backfills', () => {
    // Ordering is the whole defect: every backfill must live AFTER the
    // guard, so that reaching one is decided by the guard and not by which
    // fields happened to be checked first.
    const guardAt = src.indexOf('if (missing.length === 0)')
    expect(guardAt).toBeGreaterThan(-1)
    for (const backfill of ['advancementTrack: extras.advancementTrack', 'corruptionTheme: extras.corruptionTheme']) {
      expect(src.indexOf(backfill)).toBeGreaterThan(guardAt)
    }
  })
})
