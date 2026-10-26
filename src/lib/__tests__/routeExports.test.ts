// src/lib/__tests__/routeExports.test.ts
//
// A Next.js route.ts may only export the names the framework reserves.
//
// This exists because of a production build failure that CI was green
// for. `src/app/api/campaigns/[id]/world-chronicle/route.ts` exported a
// paging constant, and `next build` rejected it:
//
//   Type error: Route "…/world-chronicle/route.ts" does not match the
//   required types of a Next.js Route.
//     "CHRONICLE_PAGE_SIZE" is not a valid Route export field.
//
// The whole class of error is invisible to everything this repo runs
// before deploying. `tsc --noEmit` cannot see it: the constraint only
// exists once `next build` has generated its per-route type validators.
// Nor can vitest, or lint. So the merge went in green and the production
// deploy failed, and the first signal was a deploy that never shipped.
//
// The cheap fix is a convention test rather than a full `next build` in
// CI — the same trade this repo already makes for route coverage, column
// wiring and derived doc counts. It runs in milliseconds and catches the
// one mistake that actually happened.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const API_ROOT = join(REPO_ROOT, 'src', 'app', 'api')

/**
 * What Next.js accepts from a route module.
 *
 * The HTTP methods, plus the route segment config it documents. Kept as a
 * list rather than a pattern because the framework's own list is closed —
 * a new name here should be a deliberate addition made against their
 * docs, not something a regex waves through.
 */
const ALLOWED_ROUTE_EXPORTS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'OPTIONS',
  'dynamic',
  'dynamicParams',
  'revalidate',
  'fetchCache',
  'runtime',
  'preferredRegion',
  'maxDuration',
])

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) routeFiles(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

/**
 * Exported names in one module, by source text.
 *
 * Deliberately crude, and biased towards false POSITIVES rather than
 * false negatives: it would rather flag something legal than miss an
 * illegal export, because the cost of the former is one line in this
 * allowlist and the cost of the latter is a failed production deploy.
 * `export type` and `export interface` are skipped — they are erased
 * before the framework ever sees the module.
 */
function exportedNames(source: string): string[] {
  const names: string[] = []
  const patterns = [
    /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    /^export\s+class\s+([A-Za-z_$][\w$]*)/gm,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) names.push(match[1])
  }
  return names
}

describe('API route modules export only what Next.js allows', () => {
  it('finds routes to check at all', () => {
    // A passing test over an empty list is the failure mode this guards
    // against in every other convention test here.
    expect(routeFiles(API_ROOT).length).toBeGreaterThan(100)
  })

  it('exports nothing Next.js would reject', () => {
    const offenders: string[] = []

    for (const file of routeFiles(API_ROOT)) {
      const relative = file.slice(REPO_ROOT.length + 1)
      for (const name of exportedNames(readFileSync(file, 'utf8'))) {
        if (!ALLOWED_ROUTE_EXPORTS.has(name)) {
          offenders.push(`${relative}: ${name}`)
        }
      }
    }

    expect(
      offenders.sort(),
      'a route.ts may only export an HTTP method or a route segment config. ' +
        'Move a shared constant or helper into src/lib and import it — ' +
        '`next build` rejects anything else, and tsc cannot see it.'
    ).toEqual([])
  })

  it('also rejects a re-export, which the framework treats the same way', () => {
    // Belt and braces on the matcher above: `export { X } from './y'` is a
    // shape it does not catch, so assert no route file uses it at all
    // rather than pretending the regex covers it.
    const withReExports = routeFiles(API_ROOT)
      .filter((file) => /^export\s*\{/m.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(REPO_ROOT.length + 1))

    expect(withReExports).toEqual([])
  })
})
