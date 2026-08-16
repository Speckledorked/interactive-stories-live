// src/lib/__tests__/routeCoverageTier.test.ts
//
// #426: "112/112 routes have a test file" is true and says less than it
// sounds like.
//
// File coverage is not behavior coverage, and `docs/ARCHITECTURE.md` has
// always said so — in prose, in a caveat paragraph, under a heading that
// says "honestly so". The honesty was doing load-bearing work that honesty
// cannot do: nothing in the repo distinguished a route consciously given a
// gate + shape test from one that was SUPPOSED to get deep coverage and
// didn't. To CI, to the Scorecard, and to anyone who skipped the caveat,
// both read as 100%.
//
// That is the shape #399 came out of. The invite-join route granted
// `role: 'PLAYER'` with nothing asserting it, so `'ADMIN'` would have
// shipped green — and that route was on nobody's "shallow tier" list. It
// just quietly had gate-only coverage, and only a targeted mutation audit
// found it.
//
// ── What this checks ──────────────────────────────────────────────────────
//
// The tier is DERIVED from the route, not declared by hand. A hand-written
// label is a second thing to keep in sync with the first, and this codebase
// has enough of those (see #397, #424). Instead:
//
//   HIGH RISK  = the route mutates, AND touches money, access control, or
//                state belonging to someone other than the caller.
//   Everything else is gate + shape by default, which is a reasonable
//   amount of test for a list endpoint.
//
// A high-risk route must have a test that asserts something beyond the
// status code — that a specific payload reached the database, or that a
// specific field came back. Auth gates are necessary and are not enough:
// #399's route had a passing auth test and shipped the wrong role.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const API_ROOT = join(REPO_ROOT, 'src', 'app', 'api')
const ARCHITECTURE = readFileSync(join(REPO_ROOT, 'docs', 'ARCHITECTURE.md'), 'utf8')

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) routeFiles(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const MUTATING_METHOD = /export\s+async\s+function\s+(?:POST|PATCH|PUT|DELETE)\b/

/**
 * What makes a mutation high-risk. Money, access control, or state owned by
 * someone other than the caller — the three places a silent wrong value is
 * worst. Deliberately matched against the route's own source rather than a
 * hand-kept list, so a new route inherits the classification instead of
 * needing to be remembered.
 */
const HIGH_RISK_SIGNALS = [
  // Money.
  /\b(?:stripe|balanceCents|credits|checkout|refund|priceOf|canAfford|applyGoldDelta)\b/,
  // Access control and identity.
  /\b(?:UserRole|role:\s*['"]|membership\.role|requireCampaignAdmin|revokeAllSessions|tokenVersion|banned|isBanned)\b/,
  // State owned by another user.
  /\b(?:campaignMembership|blockedUser|friendRequest|turnTracker)\b/,
]

function isHighRisk(source: string): boolean {
  if (!MUTATING_METHOD.test(source)) return false
  return HIGH_RISK_SIGNALS.some((signal) => signal.test(source))
}

/** The test file for a route, by this repo's fixed `__tests__` convention. */
function testFileFor(routePath: string): string | null {
  const dir = join(dirname(routePath), '__tests__')
  if (!existsSync(dir)) return null
  const candidates = readdirSync(dir).filter((f) => f.endsWith('.test.ts'))
  return candidates.length > 0 ? join(dir, candidates[0]) : null
}

/**
 * Does this test assert anything beyond a status code?
 *
 * `toHaveBeenCalledWith` proves a specific payload reached the client;
 * asserting on a parsed body proves a specific value came back. Either is
 * evidence the test knows what the route is FOR, not just that it refused
 * an anonymous caller.
 */
const BEHAVIORAL_ASSERTION = /toHaveBeenCalledWith|\bbody\.[a-zA-Z]|toMatchObject|toEqual\(\s*(?:expect\.)?objectContaining/

interface RouteInfo {
  route: string
  highRisk: boolean
  behavioral: boolean
}

function classifyRoutes(): RouteInfo[] {
  return routeFiles(API_ROOT).map((routePath) => {
    const source = readFileSync(routePath, 'utf8')
    const testPath = testFileFor(routePath)
    const testSource = testPath ? readFileSync(testPath, 'utf8') : ''
    return {
      route: routePath.replace(join(REPO_ROOT, 'src', 'app', 'api') + '/', '').replace('/route.ts', '') || '/',
      highRisk: isHighRisk(source),
      behavioral: BEHAVIORAL_ASSERTION.test(testSource),
    }
  })
}

function claimed(key: string): number {
  const match = ARCHITECTURE.match(new RegExp(`<!--\\s*derived:${key}=(\\d+)\\s*-->`))
  if (!match) {
    throw new Error(
      `docs/ARCHITECTURE.md has no <!-- derived:${key}=N --> marker. Add one next to the ` +
        `prose that states this number, so the claim is checkable rather than asserted.`
    )
  }
  return Number(match[1])
}

describe('route coverage depth is derived, not asserted (#426)', () => {
  it('every high-risk route asserts more than its auth gate', () => {
    // The claim the Scorecard makes, turned into a check. A high-risk route
    // whose test only asserts status codes is exactly #399 waiting to
    // happen — and #399 shipped green for months.
    const shallow = classifyRoutes()
      .filter((r) => r.highRisk && !r.behavioral)
      .map((r) => r.route)

    expect(
      shallow,
      `These routes mutate money, access control, or another user's state, and their ` +
        `tests assert only status codes. An auth gate proves nobody anonymous got in; it ` +
        `proves nothing about what the route WROTE. #399 is the worked example: the ` +
        `invite-join route granted a role no test ever looked at, so 'ADMIN' would have ` +
        `shipped green.\n\nAdd at least one assertion on the payload that reached the ` +
        `database, or on a field in the response.\n  ` +
        shallow.join('\n  ')
    ).toEqual([])
  })

  it('states the real number of high-risk routes', () => {
    const actual = classifyRoutes().filter((r) => r.highRisk).length

    expect(claimed('highRiskRouteCount')).toBe(actual)
  })

  it('states the real number of routes with behavioral assertions', () => {
    const actual = classifyRoutes().filter((r) => r.behavioral).length

    expect(claimed('behavioralRouteCount')).toBe(actual)
  })

  it('classifies a non-trivial share of routes as high-risk, so the check has teeth', () => {
    // A predicate that matches nothing passes forever and means nothing —
    // #395's exact failure. If a refactor renames the signals out from
    // under this, the count collapsing is the symptom to catch.
    const routes = classifyRoutes()

    expect(routes.length).toBeGreaterThan(100)
    expect(routes.filter((r) => r.highRisk).length).toBeGreaterThan(10)
  })
})
