// src/lib/game/tick/__tests__/zeroAiBoundary.test.ts
// #419: the tick's AI-free boundary, enforced by a mechanism.
//
// docs/ARCHITECTURE.md's strongest architectural claim is that the world
// tick makes "zero AI calls… across every handler AND EVERYTHING IT
// TRANSITIVELY IMPORTS". The runtime property genuinely holds — the audit
// verified it across the full closure — but nothing enforced it.
//
// npcDispositionTick imported `ConsequenceAction` from
// @/lib/ai/consequenceExtraction, which transitively imports openaiFetch.
// The import is type-only, so TypeScript erased it and nothing reached the
// bundle — but it was NOT written `import type`, so the boundary was
// upheld by a compiler optimisation rather than by anything a reader could
// see. One value usage added to that import would have silently pulled an
// AI client into the tick closure, and no test would have noticed.
//
// An architectural boundary that matters, stated in prose and enforced by
// nothing, is a boundary that holds until someone is in a hurry.
//
// ── Scope ─────────────────────────────────────────────────────────────────
//
// The claim is about the HANDLER PASS, not about everything in this
// directory. worldTick.ts's own function body calls
// logSignificantChanges/syncWikiEntriesForChanges AFTER the transaction
// commits, and those legitimately embed and narrate — the audit counted
// seven such post-commit call sites and the doc's error was claiming
// "one", not claiming they don't exist. So this walks the transitive
// closure of the REGISTERED TICK_HANDLERS specifically.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const SRC_ROOT = join(__dirname, '..', '..', '..', '..')
const TICK_DIR = join(__dirname, '..')
const WORLD_TICK = join(TICK_DIR, '..', 'worldTick.ts')

/** Strip comments so prose ABOUT the boundary doesn't trip the scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

/** Resolve an import specifier to a file on disk, or null if it's a package. */
function resolveImport(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(SRC_ROOT, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(fromFile), specifier)
      : null
  if (!base) return null

  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Every VALUE import in a file — `import type` is deliberately excluded. */
function valueImports(source: string): string[] {
  const specifiers: string[] = []
  for (const line of stripComments(source).split('\n')) {
    // `import type { X } from` and `import { type X } from` are erased and
    // therefore cannot make a network call. That distinction is the whole
    // point of the fix this guards.
    const match = line.match(/^import\s+(?!type\b)([^'"]*)from\s+['"]([^'"]+)['"]/)
    if (!match) continue
    if (/^\s*\{\s*type\s/.test(match[1]) && !/,/.test(match[1])) continue
    specifiers.push(match[2])
  }
  return specifiers
}

/** The modules the registered tick handlers actually pull in at runtime. */
function handlerClosure(): Map<string, string> {
  const worldTickSource = readFileSync(WORLD_TICK, 'utf8')
  const declaration = stripComments(worldTickSource).match(/const TICK_HANDLERS: TickHandler\[\] = \[([^\]]*)\]/)
  if (!declaration) throw new Error('TICK_HANDLERS declaration not found — this guard needs updating')

  const handlerNames = declaration[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // Map each registered handler back to the module it was imported from,
  // so a handler that is defined but never registered is correctly out of
  // scope, and a newly registered one is automatically in it.
  const roots: string[] = []
  for (const name of handlerNames) {
    const importLine = worldTickSource.match(
      new RegExp(`^import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`, 'm')
    )
    if (!importLine) throw new Error(`Could not find the import for registered handler ${name}`)
    const resolved = resolveImport(WORLD_TICK, importLine[1])
    if (resolved) roots.push(resolved)
  }

  const seen = new Map<string, string>()
  const queue = [...roots]
  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    const source = readFileSync(file, 'utf8')
    seen.set(file, source)
    for (const specifier of valueImports(source)) {
      const resolved = resolveImport(file, specifier)
      if (resolved && !seen.has(resolved)) queue.push(resolved)
    }
  }
  return seen
}

describe('the world tick handler pass imports no AI values (#419)', () => {
  it('pulls no lib/ai module into the handler closure at runtime', () => {
    const offenders = [...handlerClosure().keys()].filter((file) => file.includes(`${'/lib/ai/'}`))

    expect(
      offenders.map((f) => f.replace(SRC_ROOT, 'src')),
      `These lib/ai modules are reachable from a registered TICK_HANDLER by VALUE import. ` +
        `The handler pass is AI-free by design and ARCHITECTURE.md states so as a load-bearing ` +
        `claim — write "import type" if only the type is needed. If a handler genuinely needs ` +
        `an AI call, the claim needs revising before the code does.`
    ).toEqual([])
  })

  it('calls no AI client anywhere in the handler closure', () => {
    const offenders = [...handlerClosure().entries()]
      .filter(([, source]) => /\b(openaiFetch|anthropicFetch|embedWithCostTracking)\s*\(/.test(stripComments(source)))
      .map(([file]) => file.replace(SRC_ROOT, 'src'))

    expect(offenders, 'A module in the tick handler closure makes an AI call.').toEqual([])
  })

  it('uses no random source, so a tick is reproducible from state alone', () => {
    // This was the ORIGINAL basis for the determinism claim, and it still
    // holds — the tick uses stableHash, never Math.random. #375 broke
    // determinism a different way (capOrdering's new Date() became the
    // selection key for every capped query), which is why the wall clock
    // is now captured once in worldTick.ts and passed in rather than read
    // inside a handler.
    const offenders = [...handlerClosure().entries()]
      .filter(([, source]) => /Math\.random\s*\(/.test(stripComments(source)))
      .map(([file]) => file.replace(SRC_ROOT, 'src'))

    expect(offenders, 'A module in the tick handler closure uses Math.random.').toEqual([])
  })
})
