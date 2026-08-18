// src/lib/game/__tests__/resourceSlotsPrecedence.test.ts
//
// #445 (F-04): the SQL backfill and the TS derivation are one rule, so they
// have to stay one rule.
//
// #378 shipped both — deriveResourceSlots for new rows and a CASE expression
// for existing ones — and they disagreed from the day they landed. The SQL
// concatenated locationType, name and description into a single haystack and
// tested `ruin|wasteland|…` against it FIRST; the TS tests each haystack
// separately in priority order and has that same pattern LAST. "Ironhold
// Mine, once a ruin of the old kingdom" is ['ore'] in one and [] in the
// other, and [] is the exact value that makes logisticsTick skip a location
// forever — the failure #378 existed to fix, reintroduced by the fix.
//
// Nobody was going to notice: the SQL runs once, on a machine, against data
// no test looks at. So the check is structural — parse both, compare.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { deriveResourceSlots } from '../resourceSlots'

const MIGRATIONS = join(process.cwd(), 'prisma', 'migrations')
const CORRECTIVE = '20260817060000_resource_slots_precedence'

function migrationSql(name: string): string {
  return readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf-8')
}

/** The ordered (haystack column, regex source, slots) triples of the CASE. */
function parseCase(sql: string): Array<{ haystack: string; pattern: string; slots: string[] }> {
  const re = /WHEN COALESCE\((?:"?)(\w+)(?:"?), ''\) ~\* '\(([^)]+)\)'\s*\n\s*THEN (ARRAY\[[^\]]*\])/g
  const out: Array<{ haystack: string; pattern: string; slots: string[] }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(sql))) {
    const slots = [...m[3].matchAll(/'([^']+)'/g)].map((s) => s[1])
    out.push({ haystack: m[1], pattern: m[2], slots })
  }
  return out
}

/** TYPE_HINTS, read out of the module source in declaration order. */
function parseTypeHints(): Array<{ pattern: string; slots: string[] }> {
  const src = readFileSync(join(process.cwd(), 'src', 'lib', 'game', 'resourceSlots.ts'), 'utf-8')
  const block = src.slice(src.indexOf('const TYPE_HINTS'), src.indexOf('export function deriveResourceSlots'))
  return [...block.matchAll(/\{ match: \/([^/]+)\/i, slots: \[([^\]]*)\] \}/g)].map((m) => ({
    pattern: m[1],
    slots: [...m[2].matchAll(/'([^']+)'/g)].map((s) => s[1]),
  }))
}

describe('the SQL backfill and deriveResourceSlots are one rule (#445)', () => {
  const hints = parseTypeHints()
  const branches = parseCase(migrationSql(CORRECTIVE))

  it('reads both sides', () => {
    // Neither parser silently matching nothing is what makes the comparison
    // below mean anything.
    expect(hints.length).toBeGreaterThanOrEqual(8)
    expect(branches.length).toBe(hints.length * 3)
  })

  it('tests the three haystacks in the priority order the code uses', () => {
    const order = branches.map((b) => b.haystack)
    const expected = ['locationType', 'name', 'description'].flatMap((h) => hints.map(() => h))
    expect(order).toEqual(expected)
  })

  it('runs the full hint list against each haystack, in TYPE_HINTS order', () => {
    for (let h = 0; h < 3; h++) {
      const slice = branches.slice(h * hints.length, (h + 1) * hints.length)
      expect(slice.map((b) => b.pattern)).toEqual(hints.map((x) => x.pattern))
      expect(slice.map((b) => b.slots)).toEqual(hints.map((x) => x.slots))
    }
  })

  it('agrees with deriveResourceSlots on the case that made the two differ', () => {
    // The concrete divergence, asserted against the real function so this
    // does not just compare two copies of the same mistake.
    expect(
      deriveResourceSlots({
        name: 'Ironhold Mine',
        locationType: null,
        description: 'Once a ruin of the old kingdom, reopened last winter.',
      })
    ).toEqual(['ore'])

    // The old SQL reached `ruin` first over the concatenated haystack. The
    // corrective CASE cannot: `name ~* mine` comes before any description
    // branch at all.
    const nameMine = branches.findIndex((b) => b.haystack === 'name' && /mine/.test(b.pattern))
    const descRuin = branches.findIndex((b) => b.haystack === 'description' && /ruin/.test(b.pattern))
    expect(nameMine).toBeLessThan(descRuin)
  })

  it('keeps the settlement default as the final fallback', () => {
    // A location whose type nobody phrased recognisably still produces
    // something. The failure mode being fixed is a world where nothing
    // produces anything.
    expect(migrationSql(CORRECTIVE)).toMatch(/ELSE ARRAY\['grain'\]/)
    expect(deriveResourceSlots({ name: 'Somewhere' })).toEqual(['grain'])
  })

  it('is the newest migration touching resourceSlots, so it wins', () => {
    // Ordering matters: the corrective UPDATE has to run AFTER the original
    // backfill, or it is silently undone on a fresh database.
    //
    // Comments are stripped before the match, because what matters is what a
    // migration DOES. 20260817230000_repair_world_turn_integrity_tail names
    // this column in prose — it replays a tail production never ran, and
    // explains that it deliberately leaves the resourceSlots backfill out
    // precisely BECAUSE the corrective migration below supersedes it. Reading
    // that explanation as a competing write would fail this guard for saying
    // the right thing, which is the same trap readmeSymbols fell into when it
    // flagged prose describing a deleted symbol.
    const withoutComments = (sql: string) => sql.replace(/--[^\n]*/g, '')
    const touching = readdirSync(MIGRATIONS)
      .filter((d) => {
        try { return /resourceSlots/.test(withoutComments(migrationSql(d))) } catch { return false }
      })
      .sort()
    expect(touching[touching.length - 1]).toBe(CORRECTIVE)
  })

  it('still catches a LATER migration that really writes resourceSlots', () => {
    // The comment-stripping above must not blind the guard to a real
    // competing write. A migration whose SQL actually assigns the column is
    // caught regardless of what its comments say.
    const later = '-- resourceSlots: nothing to see here\nUPDATE "Location" SET "resourceSlots" = ARRAY[\'ore\'];'
    expect(/resourceSlots/.test(later.replace(/--[^\n]*/g, ''))).toBe(true)

    const commentOnly = '-- mentions resourceSlots only in prose\nSELECT 1;'
    expect(/resourceSlots/.test(commentOnly.replace(/--[^\n]*/g, ''))).toBe(false)
  })
})
