// scripts/check-migrations-immutable.ts
//
// I/O half: reads git history for every migration file and reports any that
// were edited after the commit that introduced them. The decision lives in
// migrationImmutability.ts so it is testable without a repository.
//
// Needs FULL git history. `actions/checkout@v4` clones with fetch-depth 1 by
// default, which would make every file look like it had exactly one commit —
// the check would pass vacuously and forever. So it refuses to run on a
// shallow clone rather than reporting green, the same rule the scorecard gate
// follows (#443: a check that could not run has not passed).

import { execFileSync } from 'child_process'
import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { findViolations, findStaleAllowances, KNOWN_EDITED, type MigrationHistory } from './migrationImmutability'

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations')

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim()
}

function fail(message: string): never {
  console.error(`::error::${message}`)
  process.exit(1)
}

if (git(['rev-parse', '--is-shallow-repository']) === 'true') {
  fail(
    'Refusing to run on a shallow clone: every migration file would appear to have exactly ' +
    'one commit and this check would pass without examining anything. Set fetch-depth: 0 on ' +
    'the checkout step.'
  )
}

if (!existsSync(MIGRATIONS_DIR)) fail(`No migrations directory at ${MIGRATIONS_DIR}`)

const histories: MigrationHistory[] = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((name) => existsSync(join(MIGRATIONS_DIR, name, 'migration.sql')))
  .map((name) => {
    const path = `prisma/migrations/${name}/migration.sql`
    const log = git(['log', '--format=%H', '--follow', '--', path])
    return { name, commits: log ? log.split('\n').filter(Boolean) : [] }
  })

if (histories.length === 0) fail('Found no migration files to check.')

const violations = findViolations(histories)
const stale = findStaleAllowances(histories)

if (violations.length === 0 && stale.length === 0) {
  console.log(
    `All ${histories.length} migration files are unmodified since the commit that introduced ` +
    `them (${Object.keys(KNOWN_EDITED).length} historical exceptions recorded).`
  )
  process.exit(0)
}

if (violations.length > 0) {
  console.error('')
  console.error('A merged migration file has been edited.')
  console.error('')
  console.error('`prisma migrate deploy` keys on the migration NAME. Once a name is recorded in')
  console.error('_prisma_migrations it is never run again, and deploy does NOT fail on a checksum')
  console.error('mismatch — it reports success and moves on. So edits to an applied migration run')
  console.error('in CI (which builds its database from the current files) and never run in')
  console.error('production. That is how every campaign page broke for a day and a half with CI')
  console.error('green throughout.')
  console.error('')
  console.error('Add a NEW migration instead. If the change must be idempotent for environments')
  console.error('that already ran the original, use IF NOT EXISTS / ON CONFLICT DO NOTHING.')
  console.error('')
  for (const v of violations) console.error(`  ${v.name} — ${v.reason}`)
}

if (stale.length > 0) {
  console.error('')
  console.error('Stale entries in KNOWN_EDITED — remove them, or the list rots into a')
  console.error('suppression file nobody audits:')
  console.error('')
  for (const s of stale) console.error(`  ${s}`)
}

console.error('')
fail('Migration immutability check failed. See the detail above.')
