// scripts/check-schema-drift.ts
//
// I/O half of the migration-drift check. The decisions live in schemaDrift.ts
// so they are testable without a database; this file only runs prisma, reads
// the snapshot, and picks an exit code.
//
// Usage (CI):  DATABASE_URL=... npx tsx scripts/check-schema-drift.ts
//
// Requires a database that has had the full migration history applied — in CI
// that is the step immediately before this one. Comparing against the migrated
// database rather than a shadow database is deliberate: the shadow reset drops
// the public schema, and these migrations need the pgvector extension that the
// separate "Enable pgvector" step creates and no migration recreates.

import { execFileSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { normalizeDiff, parseExpected, compareDrift, isEmptyDiff } from './schemaDrift'

const EXPECTED_PATH = join(process.cwd(), 'prisma', 'schema-drift-expected.txt')

function fail(message: string): never {
  console.error(`::error::${message}`)
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  // #443's rule: a check that could not run has not passed.
  fail(
    'DATABASE_URL is not set, so schema.prisma was never compared to the migration history. ' +
    'Failing rather than reporting green for a comparison that did not happen.'
  )
}

if (!existsSync(EXPECTED_PATH)) {
  fail(
    `Missing ${EXPECTED_PATH}. That file records the residual difference prisma cannot ` +
    'express (see scripts/schemaDrift.ts), and without it this check has no baseline to ' +
    'compare against.'
  )
}

let diffOutput: string
try {
  diffOutput = execFileSync(
    'npx',
    [
      'prisma',
      'migrate',
      'diff',
      '--from-url',
      databaseUrl,
      '--to-schema-datamodel',
      'prisma/schema.prisma',
    ],
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
  )
} catch (error) {
  const e = error as { stdout?: string; stderr?: string; message?: string }
  fail(
    'prisma migrate diff failed to run, so no comparison happened:\n' +
    (e.stderr || e.stdout || e.message || String(error))
  )
}

const actual = normalizeDiff(diffOutput)
const expected = parseExpected(readFileSync(EXPECTED_PATH, 'utf-8'))
const { unexpected, stale, ok } = compareDrift(actual, expected)

if (ok) {
  if (isEmptyDiff(actual)) {
    console.log('No drift: the migration history reproduces schema.prisma exactly.')
  } else {
    console.log(
      `No new drift. ${expected.length} recorded residual line(s) still present, all of them ` +
      'differences prisma cannot express — see prisma/schema-drift-expected.txt.'
    )
  }
  process.exit(0)
}

if (unexpected.length > 0) {
  console.error('')
  console.error('DRIFT: schema.prisma and prisma/migrations disagree in ways not recorded as expected.')
  console.error('')
  for (const line of unexpected) console.error(`  + ${line}`)
  console.error('')
  console.error('Read the direction carefully: this diff goes FROM the migrated database TO')
  console.error('schema.prisma, so "Removed column X" means the database HAS X and the model')
  console.error('does not. Fix by generating a migration for the model change')
  console.error("(npx prisma migrate dev --name <change>), or by declaring in schema.prisma what")
  console.error('the database already contains.')
}

if (stale.length > 0) {
  console.error('')
  console.error('STALE EXPECTATION: prisma/schema-drift-expected.txt records differences that no')
  console.error('longer appear. Remove them — an exception list nobody prunes is how a check')
  console.error('quietly stops asserting anything.')
  console.error('')
  for (const line of stale) console.error(`  - ${line}`)
}

console.error('')
fail('Migration drift check failed. See the detail above.')
