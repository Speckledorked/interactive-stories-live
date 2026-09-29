// src/app/api/__tests__/healthRoutesGated.convention.test.ts
//
// Every *-health diagnostic route must authenticate its caller.
//
// The family shipped anonymous, with a rate limit standing in for a gate,
// and a rate limit is not a gate — these four were doing four different
// things nobody outside the deploy should be able to do:
//
//   ai-health      spent real provider money on every hit (#509) and
//                  published the deployment's whole model roster.
//   stripe-health  answered "which payment secrets is this deployment
//                  missing" — including whether webhooks can be verified.
//   email-health   the same readout for mail credentials.
//   queue-health   took a campaign id as authorisation and then WROTE
//                  (recoverStaleJobs re-kicks jobs), on an id that travels
//                  in the app's own URL bar.
//
// Three of them were also keyed on the literal string 'anonymous', which
// is one shared bucket for the entire internet: any caller could hold the
// limit at its ceiling and deny the operator the diagnostic.
//
// A source scan rather than a request-level test, because what needs
// guarding is that a NEW sibling — added next to three files that already
// look like this — cannot be born anonymous. The failure is an omission,
// and an omission has no call site to assert against.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const API = join(__dirname, '..')

function healthRoutes(): string[] {
  return readdirSync(API)
    .filter((d) => d.endsWith('-health'))
    .map((d) => join(d, 'route.ts'))
}

/**
 * Source with `import` lines removed. Without this every check below is
 * satisfied by the import alone: deleting the actual gate while leaving
 * `import { isPlatformAdminEmail }` in place — exactly what a careless
 * edit leaves behind — kept the whole suite green when it was first
 * written. The guard has to look at the body, not the header.
 */
function body(route: string): string {
  return readFileSync(join(API, route), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*import\b/.test(line))
    .join('\n')
}

describe('diagnostic health routes', () => {
  it('finds the health routes at all', () => {
    // A directory rename must break this loudly rather than quietly
    // leaving nothing to check (a check that cannot run has not passed).
    expect(healthRoutes().length).toBeGreaterThanOrEqual(4)
  })

  it('all authenticate the caller', () => {
    const anonymous = healthRoutes().filter((r) => !body(r).includes('getUser(request)'))
    expect(
      anonymous,
      `Health routes with no caller authentication: ${anonymous.join(', ')}`
    ).toEqual([])
  })

  it('all authorise beyond merely being signed in', () => {
    // Either platform admin (operator diagnostics) or campaign membership
    // (the player-facing queue check) — but never "any account will do".
    const unauthorised = healthRoutes().filter((r) => {
      const source = body(r)
      return !source.includes('isPlatformAdminEmail(') && !source.includes('getCampaignMembership(')
    })
    expect(
      unauthorised,
      `Health routes gated on sign-in alone: ${unauthorised.join(', ')}`
    ).toEqual([])
  })

  it('none key their rate limit on the shared "anonymous" bucket', () => {
    const shared = healthRoutes().filter((r) => body(r).includes("checkRateLimit('anonymous'"))
    expect(
      shared,
      `One bucket for every caller, so anyone can exhaust it for everyone: ${shared.join(', ')}`
    ).toEqual([])
  })
})
