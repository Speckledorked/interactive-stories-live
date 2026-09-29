// src/__tests__/internalLinksResolve.test.ts
//
// Every internal <Link href="/..."> must point at a route that exists.
//
// #498: the signup form's fine print linked /terms and /privacy, and both
// 404'd — on the one screen where a broken legal link is worst, because it
// appears at the exact moment someone is asked to agree to it. Nothing
// caught it because `href` is just a string: a Link to a route that was
// never created type-checks exactly like a Link to one that was.
//
// Scanned from source rather than crawled, so it runs in unit tests with no
// server. Static hrefs only — a template literal is a runtime value and its
// destination cannot be known from the text.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..')
const SRC = join(ROOT, 'src')
const APP = join(SRC, 'app')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue
      walk(full, out)
    } else if (entry.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

/**
 * Does the App Router serve this path?
 *
 * Only fully static paths are checked. A segment that is dynamic in the
 * route tree (`[id]`) cannot be matched against a literal href without
 * reimplementing the router, so any href whose resolution would need that
 * is skipped rather than guessed at — see collectStaticHrefs.
 */
function routeExists(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean)
  const dir = join(APP, ...segments)
  return ['page.tsx', 'page.ts', 'route.ts'].some((f) => existsSync(join(dir, f)))
}

function collectStaticHrefs(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const file of walk(SRC)) {
    const source = readFileSync(file, 'utf8')
    // href="/..." only: no braces, so no template literals and no
    // expressions. Query strings and hashes are stripped before matching.
    for (const match of source.matchAll(/href="(\/[^"{}]*)"/g)) {
      const pathname = match[1].split('?')[0].split('#')[0].replace(/\/$/, '') || '/'
      const sites = found.get(pathname) ?? []
      sites.push(file.slice(ROOT.length + 1))
      found.set(pathname, sites)
    }
  }
  return found
}

describe('internal links', () => {
  it('finds static links to check at all', () => {
    expect(collectStaticHrefs().size).toBeGreaterThan(5)
  })

  it('all resolve to a route that exists', () => {
    const broken: string[] = []
    for (const [pathname, sites] of collectStaticHrefs()) {
      if (pathname === '/') continue // app/page.tsx, checked below
      // Skip anything under a dynamic segment — not resolvable statically.
      if (pathname.includes('[')) continue
      if (!routeExists(pathname)) {
        broken.push(`${pathname} (linked from ${[...new Set(sites)].join(', ')})`)
      }
    }
    expect(broken, `Links to routes that do not exist:\n  ${broken.join('\n  ')}`).toEqual([])
  })

  it('has a root page', () => {
    expect(existsSync(join(APP, 'page.tsx'))).toBe(true)
  })
})
