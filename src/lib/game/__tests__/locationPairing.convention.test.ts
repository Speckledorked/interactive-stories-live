// src/lib/game/__tests__/locationPairing.convention.test.ts
//
// #425: Character and NPC each store location twice, and nothing enforced
// that a write sets both.
//
//   currentLocation String?   — free text, the original representation
//   locationId      String?   — the real FK, added later
//
// Neither is derived from the other. #405 fixed the writers that were
// setting only the text column and silently leaving the FK null — that
// closed the bug. What it could not close is the shape: every future write
// site has to remember, and eight comments across the codebase exist purely
// to remind people. Eight reminders is what a constraint looks like when it
// wants to be a mechanism.
//
// This is that mechanism. It is a REGRESSION guard, not a repair — every
// site in the tree already pairs them today. The point is that the next one
// can't quietly not.
//
// ── Why both columns still exist ──────────────────────────────────────────
//
// Worth stating, because "just drop the text column" is the obvious idea
// and it is wrong: the free-text column can hold a location the campaign
// has no `Location` row for. The narrator puts a character in "the back
// room of the Gilded Fen" and there may be no such row. `currentLocation`
// records it; `locationId` cannot. So a write that sets only the text is
// sometimes CORRECT — it just has to say so, which is what the exemption
// marker below is for.
//
// See #425 for the three options on collapsing this properly. This guard is
// deliberately the cheapest of them: it removes the recurrence risk without
// committing to a schema change while the un-rowed case is still real.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..', '..', '..')

/**
 * A write site may set `currentLocation` without `locationId` if it says
 * why on the same line or the line before — the un-rowed-location case
 * above. Same marker convention as capOrdering's `roster-exempt:`.
 */
const EXEMPT_MARKER = 'unrowed-location:'

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '__tests__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

/** How far back to look for the model the payload belongs to. */
const MODEL_LOOKBACK = 400

/**
 * The `data: { ... }` payload starting at `open`, brace-matched.
 *
 * A real matcher rather than a line window, and that distinction is the
 * whole guard. The first version checked for `locationId` within ±30 lines
 * of the `currentLocation` assignment — which passes a deliberately broken
 * write in `migrationTick.ts`, because the words `move.toLocationId` and
 * `locationId` appear all over that file for unrelated reasons. The guard
 * was reading "this file mentions locationId somewhere" and calling it
 * "this WRITE sets locationId". Only mutation-testing it showed the
 * difference.
 */
function payloadAt(source: string, open: number): string {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  return source.slice(open)
}

interface Offender {
  file: string
  line: number
}

function unpairedWrites(): Offender[] {
  const offenders: Offender[] = []

  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8')

    for (const match of source.matchAll(/\bdata:\s*\{/g)) {
      const open = source.indexOf('{', match.index ?? 0)
      const payload = payloadAt(source, open)

      // An ASSIGNMENT of the column, not a select (`currentLocation: true`)
      // and not a type annotation (`currentLocation: string | null`).
      const assigns =
        /(?:^|[\s{,])currentLocation:\s*/.test(payload) &&
        !/currentLocation:\s*(?:true|false)\b/.test(payload) &&
        !/currentLocation:\s*(?:string|number|boolean)\b/.test(payload)
      if (!assigns) continue

      // Only the two models that carry BOTH columns.
      // `WorldMeta.currentLocation` is a different field on a model with no
      // `locationId` at all — it records where the CAMPAIGN's focus is, not
      // an entity's position, so there is nothing for it to pair with.
      // Flagging it would demand a column that doesn't exist, which is how
      // a guard earns its own suppression.
      const before = source.slice(Math.max(0, open - MODEL_LOOKBACK), open)
      if (!/\b(?:character|nPC)\.(?:create|update|updateMany|upsert|create[A-Za-z]*)\b/i.test(before)) continue

      if (/\blocationId\b/.test(payload)) continue
      if (before.slice(-200).includes(EXEMPT_MARKER)) continue

      offenders.push({
        file: file.replace(SRC + '/', ''),
        line: source.slice(0, open).split('\n').length,
      })
    }
  }

  return offenders
}

describe('Location writes set both columns (#425)', () => {
  it('never writes currentLocation without locationId', () => {
    const offenders = unpairedWrites()

    expect(
      offenders.map((o) => `${o.file}:${o.line}`),
      `These write Character/NPC.currentLocation without setting locationId in the same ` +
        `payload. The two columns are not derived from each other, so a text-only write ` +
        `leaves the FK pointing at the previous location — or at nothing — while the ` +
        `narrative field says otherwise. That is #405, which was fixed once already.\n\n` +
        `Resolve the id (every write site in the tree has a locations fetch to hand), or — ` +
        `if this is genuinely a place the campaign has no Location row for — write ` +
        `"${EXEMPT_MARKER} <reason>" on the line above and say which.\n  ` +
        offenders.map((o) => `${o.file}:${o.line}`).join('\n  ')
    ).toEqual([])
  })

  it('finds the write sites at all, so a passing result means something', () => {
    // The failure mode of a scan-based guard is scanning nothing and
    // reporting success. #395 was exactly that shape — a filter that could
    // never match, reading as "all clear" forever. This asserts the scan
    // has real write sites in range.
    let assignments = 0
    for (const file of sourceFiles(SRC)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (/(?:^|[\s{,])currentLocation:\s*/.test(line) && !/currentLocation:\s*true\b/.test(line)) {
          assignments++
        }
      }
    }

    expect(assignments).toBeGreaterThan(3)
  })
})
