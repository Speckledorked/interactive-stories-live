// src/__tests__/deployOrdering.test.ts
//
// vercel.json is the one load-bearing file in this repo that nothing
// typechecks, nothing lints, and no test exercised — and it is the file
// that decides whether a deploy can leave production with a schema its
// code has never seen. It has now caused one real outage and one
// near-miss, so the rules it encodes are pinned here.
//
// THE OUTAGE (2026-08-16). The build command ran `prisma migrate deploy`
// unconditionally and FIRST. Two independent failures came out of that
// single ordering:
//
//   1. A preview build migrated the production database, so a migration
//      landed the moment a PR built a preview rather than when it merged
//      (#435, fixed by gating on VERCEL_ENV).
//
//   2. Migrating BEFORE the build meant a build that then failed — or
//      simply never got to run, as happened when the account hit its
//      daily deploy limit — left the schema moved and the matching code
//      unshippable. Production served pre-migration code against a
//      post-migration database until a later deploy rescued it. That is
//      #434, and it is what the ordering asserted below fixes.
//
// Running the migration last means a broken build fails before touching
// the database, so the worst case is a failed deploy with production
// untouched — which is the correct worst case.
//
// This does NOT make destructive migrations safe. The new deployment is
// promoted after the build, so there is still a window where the new
// schema is live and the old code is serving. Expand/contract remains the
// rule for anything that drops or renames.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const config = JSON.parse(
  readFileSync(join(process.cwd(), 'vercel.json'), 'utf-8')
) as { buildCommand?: string }

const buildCommand = config.buildCommand ?? ''

describe('vercel.json build command', () => {
  it('exists at all', () => {
    expect(buildCommand).toBeTruthy()
  })

  it('generates the Prisma client before building', () => {
    // next build typechecks against the generated client, so a build that
    // runs first fails on types that are perfectly correct in the schema.
    expect(buildCommand.indexOf('prisma generate')).toBeGreaterThanOrEqual(0)
    expect(buildCommand.indexOf('prisma generate')).toBeLessThan(
      buildCommand.indexOf('next build')
    )
  })

  // #434. The ordering IS the fix — a migration that runs first can strand
  // production on a schema no shipped code understands.
  it('migrates only after the build has proven it can ship', () => {
    const build = buildCommand.indexOf('next build')
    const migrate = buildCommand.indexOf('prisma migrate deploy')

    expect(build, 'no `next build` in the build command').toBeGreaterThanOrEqual(0)
    expect(migrate, 'no `prisma migrate deploy` in the build command').toBeGreaterThanOrEqual(0)
    expect(
      migrate,
      'prisma migrate deploy runs before next build — a failed build would leave production mid-schema (#434)'
    ).toBeGreaterThan(build)
  })

  // #435. A preview build shares the production DATABASE_URL on this
  // plan (a free-tier Neon branch cap makes per-preview databases
  // impractical), so an ungated migration reaches production the moment
  // any PR builds a preview.
  it('only migrates on a production deploy', () => {
    expect(buildCommand).toMatch(/VERCEL_ENV/)
    expect(buildCommand).toMatch(/production/)

    // The gate has to sit around the migration itself, not around the
    // whole command — gating the build too would mean previews never
    // build at all.
    const gate = buildCommand.indexOf('VERCEL_ENV')
    const migrate = buildCommand.indexOf('prisma migrate deploy')
    expect(gate).toBeLessThan(migrate)
  })

  // `&&` between every stage, so any failing step fails the deploy rather
  // than being skipped past. `;` would swallow a non-zero exit.
  it('chains its stages so a failure stops the deploy', () => {
    expect(buildCommand).toContain('&&')
    expect(buildCommand).not.toMatch(/;\s*(prisma generate|next build)/)
  })
})
