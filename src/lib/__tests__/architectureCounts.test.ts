// src/lib/__tests__/architectureCounts.test.ts
// #397: a guard that checks CLAIMS, not strings.
//
// docs/ARCHITECTURE.md cites two guards as the reason it can be trusted,
// and neither checks a claim:
//
//   - readmeSymbols.test.ts matches backticked lowercase-first SYMBOL
//     NAMES and asserts they exist. It has nothing to say about numbers,
//     and every stale count below sailed through it. (Its own comment
//     said "1346 tests passed" while the suite was at 3,977.)
//   - check-scorecard-audit-trail.ts diffs against HEAD^1 and is
//     self-attestable — the same commit can raise a score and write its
//     own justification.
//
// So the doc drifted, and kept drifting: at the time of the second audit
// it claimed 19 tick handlers (20), 17 rate-limit sites (26), "all 104
// routes" in one place and "all 109 routes… confirmed by direct count" in
// another (111) — a stale number corrected to another stale number with
// the older one left in place.
//
// The guards enforce referential integrity of IDENTIFIERS; the document's
// actual risk is factual drift of ASSERTIONS. This closes that gap for the
// falsifiable numbers by DERIVING each one from source and requiring the
// document to agree.
//
// Marker convention: the doc carries an HTML comment naming the value it
// is asserting, e.g.
//
//     <!-- derived:tickHandlerCount=20 -->
//
// so a reader can see which number is machine-checked, and a writer who
// changes the prose without the marker fails here rather than silently.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const ARCHITECTURE = readFileSync(join(REPO_ROOT, 'docs', 'ARCHITECTURE.md'), 'utf8')

/** Every file under a directory tree, recursively. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

/** The value the doc claims for a derived quantity. */
function claimed(key: string): number {
  const match = ARCHITECTURE.match(new RegExp(`<!--\\s*derived:${key}=(\\d+)\\s*-->`))
  if (!match) {
    throw new Error(
      `docs/ARCHITECTURE.md has no <!-- derived:${key}=N --> marker. ` +
        `Add one next to the prose that states this number, so the claim is checkable.`
    )
  }
  return Number(match[1])
}

describe('ARCHITECTURE.md numeric claims are derived, not asserted (#397)', () => {
  it('states the real number of tick handlers', () => {
    const source = readFileSync(join(REPO_ROOT, 'src', 'lib', 'game', 'worldTick.ts'), 'utf8')
    const declaration = source.match(/const TICK_HANDLERS: TickHandler\[\] = \[([^\]]*)\]/)
    expect(declaration, 'TICK_HANDLERS declaration not found — this guard needs updating').toBeTruthy()

    const actual = declaration![1]
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean).length

    expect(claimed('tickHandlerCount')).toBe(actual)
  })

  it('states the real number of API routes', () => {
    const actual = walk(join(REPO_ROOT, 'src', 'app', 'api')).filter((f) => f.endsWith('route.ts')).length

    expect(claimed('apiRouteCount')).toBe(actual)
  })

  it('states the real number of rate-limited call sites', () => {
    const actual = walk(join(REPO_ROOT, 'src', 'app'))
      .filter((f) => f.endsWith('.ts') && !f.includes('__tests__'))
      .reduce((total, file) => total + (readFileSync(file, 'utf8').match(/checkRateLimit\(/g)?.length ?? 0), 0)

    expect(claimed('rateLimitCallSiteCount')).toBe(actual)
  })

  it('does not leave a contradicted count elsewhere in the prose', () => {
    // The specific failure this catches: #135's route count was corrected
    // in one place and left stale in another, so the document disagreed
    // with itself and both numbers were wrong. A guard that checks only
    // the marked number would have passed.
    const routeCount = claimed('apiRouteCount')
    // The pattern started as /all N routes/ and promptly missed two live
    // stale counts — "every one of the 111 routes" in the Current State
    // list, and "(104/104, ...)" in the Priority List. A guard narrower
    // than its name is exactly what #400 was about, and this one was mine.
    //
    // Widened to any determiner-or-none before the number, plus the N/N
    // ratio form the doc also uses. Over-matching is the safe direction:
    // a false positive is one prose edit, a false negative is the stale
    // number this file exists to prevent.
    const otherRouteClaims = [
      ...ARCHITECTURE.matchAll(/(?:all|All|the|every one of the)\s+(\d{2,4})\s+routes/g),
      ...ARCHITECTURE.matchAll(/\((\d{2,4})\/\d{2,4}[,)]/g),
    ].map((m) => Number(m[1]))

    for (const claim of otherRouteClaims) {
      expect(claim, `prose says "${claim} routes" but the derived count is ${routeCount}`).toBe(routeCount)
    }
  })

  it('does not leave a contradicted tick-handler count elsewhere in the prose', () => {
    const handlerCount = claimed('tickHandlerCount')
    const otherClaims = [...ARCHITECTURE.matchAll(/(\d{1,3})\s+(?:deterministic\s+)?`?TICK_HANDLERS`?/g)].map((m) =>
      Number(m[1])
    )

    for (const claim of otherClaims) {
      expect(claim, `prose says "${claim} TICK_HANDLERS" but the derived count is ${handlerCount}`).toBe(handlerCount)
    }
  })
})
