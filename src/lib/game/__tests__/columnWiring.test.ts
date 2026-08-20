// src/lib/game/__tests__/columnWiring.test.ts
//
// A column something READS must be a column something WRITES.
//
// Character.advancementTier shipped with two readers and zero writers. It was
// null on every character forever; the sheet mapped null onto the lowest rung
// and drew a filled bar, so a dead column looked like a working feature parked
// at the start. Typecheck cannot see this (a nullable column is legitimately
// null), and no unit test can (they supply the value they then assert on).
//
// The same shape, twice more this week: Campaign.advancementTrack generated
// and never persisted at creation, and the snapshot modal reading a ladder its
// route never sent. Each failed silently into a value that is legitimate
// elsewhere.
//
// ## What this check is, and what it is not
//
// It checks ONE direction: read-with-no-write. That direction is clean — zero
// findings across 857 scalar columns, with two recorded exceptions below.
//
// The reverse direction (written, never read) was built and DELIBERATELY not
// shipped. It produced 31 findings whose false-positive rate is high: a column
// read only through `where: { resetToken: token }` is genuinely read, and a
// lookup is not distinguishable from a write by shape alone. A gate that
// reports 31 things nobody will triage becomes a suppression file, which is
// the failure mode this repo's own allowlists are written to avoid. If someone
// wants dead-column detection later, it needs where-clause awareness first.
//
// ## Why heuristics rather than an AST
//
// Prisma writes take many shapes and the first draft of this check missed
// three of them, each found by running it and investigating what it flagged:
// raw SQL embedded in TS (`"consolidatedIntoId" = ${x}`), object shorthand as
// a final property with no trailing comma, and a field allowlist spread into
// `data`. A fourth heuristic — "the name appears as a string literal" — was
// tried and REMOVED: it matched `'advancementTier' in updateData`, a read,
// and silenced the very bug this exists to catch.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const root = process.cwd()

const SCALARS = new Set([
  'String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal', 'DateTime', 'Json', 'Bytes',
])

/**
 * Columns with a real write this check cannot see.
 *
 * Self-pruning, like migrationImmutability's KNOWN_EDITED: the test below
 * fails if an entry stops being necessary, so the list cannot rot into a
 * suppression file nobody audits.
 */
const DYNAMIC_WRITES: Record<string, string> = {
  'UserNotificationSettings.quietHoursStart':
    "written through a field allowlist in notifications/settings/route.ts — the name appears " +
    "only as a string in an ALLOWED array that is then spread into `data`.",
  'UserNotificationSettings.quietHoursEnd':
    "same allowlist spread as quietHoursStart.",
}

interface Column { model: string; name: string; type: string }

function scalarColumns(): Column[] {
  const schema = readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf-8')
  const out: Column[] = []
  for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const [, model, body] = m
    for (const f of body.matchAll(/^ {2}(\w+)\s+(\w+)(\[\])?(\??)(.*)$/gm)) {
      const [, name, type, , , rest] = f
      if (!SCALARS.has(type)) continue
      // A column the DATABASE fills needs no application write.
      if (/@default|@updatedAt|@id/.test(rest)) continue
      out.push({ model, name, type })
    }
  }
  return out
}

function sources(): { ts: string; sql: string } {
  const ts = execSync(
    "find src -name '*.ts' -o -name '*.tsx' | grep -v __tests__ | xargs cat",
    { cwd: root, maxBuffer: 256 * 1024 * 1024 }
  ).toString()
  const migrations = join(root, 'prisma', 'migrations')
  const sql = readdirSync(migrations)
    .map((d) => { try { return readFileSync(join(migrations, d, 'migration.sql'), 'utf-8') } catch { return '' } })
    .join('\n')
  return { ts, sql }
}

const { ts, sql } = sources()
const columns = scalarColumns()

function hasWrite(name: string): boolean {
  const e = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // `field: value` in an object literal. `: true` is excluded because that is
  // a Prisma `select`, which is a read.
  if (new RegExp(`\\b${e}:\\s*(?!true\\b|false\\b)`).test(ts)) return true
  // Object shorthand, with or without a trailing comma (final property).
  if (new RegExp(`^\\s*${e},?\\s*$`, 'm').test(ts)) return true
  // Direct assignment: `updateData.field = x`.
  if (new RegExp(`\\.${e}\\s*=[^=]`).test(ts)) return true
  // Raw SQL embedded in TypeScript.
  if (new RegExp(`"${e}"\\s*=`).test(ts)) return true
  // Written by a migration: a backfill, or a column added WITH a default.
  if (new RegExp(`"${e}"\\s*=`).test(sql)) return true
  if (new RegExp(`ADD COLUMN\\s+"${e}"[^;]*DEFAULT`).test(sql)) return true
  return false
}

function hasRead(name: string): boolean {
  const e = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`\\.${e}\\b`).test(ts)) return true          // property access
  if (new RegExp(`\\b${e}:\\s*true\\b`).test(ts)) return true // explicit select
  if (new RegExp(`\\{[^{}]*\\b${e}\\b[^{}]*\\}\\s*=`).test(ts)) return true // destructure
  return false
}

describe('every column a reader depends on has a writer', () => {
  it('reads the schema', () => {
    // A parser matching nothing would make the assertion below vacuous, which
    // is precisely the failure mode of the thing it is checking for.
    expect(columns.length).toBeGreaterThan(500)
    expect(columns.some((c) => c.model === 'Character' && c.name === 'advancementTier')).toBe(true)
  })

  it('finds no column that is read but never written', () => {
    const orphans = columns
      .filter((c) => !DYNAMIC_WRITES[`${c.model}.${c.name}`])
      .filter((c) => hasRead(c.name) && !hasWrite(c.name))
      .map((c) => `${c.model}.${c.name}`)
    expect(
      orphans,
      `read but never written: ${orphans.join(', ')}. Such a column holds its ` +
        `default forever while the UI renders it as though it meant something — ` +
        `which is what Character.advancementTier did on every character in every campaign.`
    ).toEqual([])
  })

  it('keeps the dynamic-write exceptions honest', () => {
    // If an entry no longer needs to be here, it comes out. Same rule as
    // migrationImmutability's allowlist and readmeSymbols' absent list.
    for (const key of Object.keys(DYNAMIC_WRITES)) {
      const [model, name] = key.split('.')
      const column = columns.find((c) => c.model === model && c.name === name)
      expect(column, `${key} is no longer a schema column — remove the exception`).toBeTruthy()
      expect(
        hasWrite(name),
        `${key} is now detectable as a write — remove it from DYNAMIC_WRITES`
      ).toBe(false)
    }
  })
})
