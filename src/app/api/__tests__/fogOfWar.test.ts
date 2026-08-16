// src/app/api/__tests__/fogOfWar.test.ts
//
// The structural half of #94, and the part that actually lasts.
//
// Replacing 23 hand-written `isDiscovered` clauses with `visibleTo()` fixes
// today. It does nothing about the real risk, which is the route someone
// adds next year that returns NPCs and forgets. Fog of war is this
// product's headline claim and the one place drift costs a data leak rather
// than a wrong number, so it should not rest on everybody remembering.
//
// So: any route that READS a fog-gated model must either use the shared
// helper, be admin-only, or be listed below with a reason. The exemptions
// are self-policing — an exempt route may only select `id` from a gated
// model, so the moment one starts returning real entity data it fails here
// instead of leaking quietly.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import * as ts from 'typescript'
import { FOG_GATED_MODELS, visibleTo } from '@/lib/api/visibility'

const API_ROOT = 'src/app/api'

/**
 * Routes allowed to read a fog-gated model without the helper, with the
 * reason. Each of these resolves a name or id to check existence and never
 * returns the row — see the `select` assertion below, which is what keeps
 * that true rather than merely claimed.
 */
const EXEMPT: Record<string, string> = {
  // campaigns/[id]/characters/route.ts's old entry here is gone on purpose,
  // not an oversight: the API-routes refactor moved character creation's
  // faction/NPC name-to-id resolution (still id-only-select, still never
  // returned) into src/lib/game/characterCreation.ts. The route file no
  // longer reads a fog-gated model at all, so it correctly drops out of
  // gatedRoutes below — but that also means this file's scan (API_ROOT is
  // src/app/api only) no longer covers that logic. It was re-verified by
  // hand at the time of the move; a future change to it isn't caught here.
  'campaigns/[id]/notes/route.ts':
    'validates that a note\'s referenced entity exists before linking it; selects id only, answers with 400 or nothing.',
  'campaigns/[id]/notes/[noteId]/route.ts':
    'same entity-reference validation as the collection route.',
}

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) routeFiles(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const rel = (path: string) => path.replace(`${API_ROOT}/`, '')

// #205: this used to be two regexes (DIRECT_READ / NESTED_READ). A regex
// can only ever match the literal dotted spelling it was written for —
// `prisma.nPC.findMany` — and would silently miss a computed/bracket
// access (`prisma['nPC'].findMany`), a query method not in its fixed
// 3-method list (`groupBy`/`aggregate`/`count`/...), or anything else
// syntactically equivalent but textually different. This repo already has
// a proven AST-walking approach for exactly this class of guard
// (entityResolutionConvention.test.ts, via the TypeScript compiler API —
// already a dependency, no new tooling) — ported here so the fog-of-war
// bypass detector inherits the same "deterministic in CI, can't be fooled
// by non-standard syntax" guarantee instead of resting on a text pattern.

const GATED_MODEL_NAMES = new Set(['nPC', 'faction', 'location', 'clock'])
// Broader than the old regex's 3-method list on purpose — any of these can
// return or reveal row data for a gated model, not just the read shapes a
// route happened to use when the original check was written.
const GATED_READ_METHODS = new Set([
  'findMany', 'findFirst', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy', 'findRaw',
])
const GATED_RELATION_KEYS = new Set(['npcs', 'factions', 'locations', 'clocks'])
const RELATION_QUERY_SUBKEYS = new Set(['where', 'orderBy', 'select'])
const DISCOVERY_FLAG_NAMES = new Set(['isDiscovered', 'isHidden'])

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text
  return null
}

interface GatedCall {
  modelName: string
  method: string
  call: ts.CallExpression
}

/**
 * Matches `prisma.nPC.findMany(...)` (PropertyAccessExpression) AND
 * `prisma['nPC'].findMany(...)` / `prisma[modelVar].findMany(...)` where the
 * bracket holds a literal string (ElementAccessExpression) — the exact
 * computed-access gap named in #205 that a regex can't see past. Requires
 * the base of the chain to literally be the `prisma` identifier, matching
 * the scoping the old regex's literal `prisma.` prefix effectively had.
 */
function asGatedCall(node: ts.Node): GatedCall | null {
  if (!ts.isCallExpression(node)) return null
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee)) return null
  const method = callee.name.text
  if (!GATED_READ_METHODS.has(method)) return null

  const modelAccess = callee.expression
  let modelName: string | null = null
  let base: ts.Expression | null = null
  if (ts.isPropertyAccessExpression(modelAccess)) {
    modelName = modelAccess.name.text
    base = modelAccess.expression
  } else if (
    ts.isElementAccessExpression(modelAccess) &&
    ts.isStringLiteralLike(modelAccess.argumentExpression)
  ) {
    modelName = modelAccess.argumentExpression.text
    base = modelAccess.expression
  }
  if (!modelName || !GATED_MODEL_NAMES.has(modelName)) return null
  if (!base || !ts.isIdentifier(base) || base.text !== 'prisma') return null

  return { modelName, method, call: node }
}

/**
 * Matches a nested-relation read — `npcs: { where: ..., orderBy: ...,
 * select: ... }` inside an `include`/`select` object — by walking the real
 * object-literal structure instead of a text window. Not padding: the main
 * campaign GET (the single most important fog-gated route in the app)
 * fetches all four models this way, through `include`, never a direct
 * `prisma.nPC.findMany` call at all.
 */
function isGatedRelationProperty(node: ts.Node): boolean {
  if (!ts.isPropertyAssignment(node)) return false
  const key = propertyName(node.name)
  if (!key || !GATED_RELATION_KEYS.has(key)) return false
  if (!ts.isObjectLiteralExpression(node.initializer)) return false
  return node.initializer.properties.some((p) => {
    if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) return false
    const subKey = propertyName(p.name)
    return subKey !== null && RELATION_QUERY_SUBKEYS.has(subKey)
  })
}

/** Every gated direct call and every gated nested-relation property found
 * anywhere in the file, walked once. */
function findGatedReads(sourceFile: ts.SourceFile): { calls: GatedCall[]; relationProps: ts.PropertyAssignment[] } {
  const calls: GatedCall[] = []
  const relationProps: ts.PropertyAssignment[] = []
  function visit(node: ts.Node) {
    const gated = asGatedCall(node)
    if (gated) calls.push(gated)
    if (isGatedRelationProperty(node)) relationProps.push(node as ts.PropertyAssignment)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return { calls, relationProps }
}

function parseFile(filePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, /* setParentNodes */ true)
}

function findProperty(obj: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
  return obj.properties.find((p) => {
    if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) return false
    return propertyName(p.name) === name
  })
}

/** True when a gated call's argument object has a `select` that reads
 * exactly `{ id: true }` and nothing else — the shape an EXEMPT route is
 * required to hold to (see `isIdOnlySelect` callers below). */
function isIdOnlySelect(call: ts.CallExpression): boolean {
  const arg = call.arguments[0]
  if (!arg || !ts.isObjectLiteralExpression(arg)) return false
  const selectProp = findProperty(arg, 'select')
  if (!selectProp || !ts.isPropertyAssignment(selectProp) || !ts.isObjectLiteralExpression(selectProp.initializer)) {
    return false
  }
  const selectObj = selectProp.initializer
  if (selectObj.properties.length !== 1) return false
  const only = selectObj.properties[0]
  if (!ts.isPropertyAssignment(only)) return false
  return propertyName(only.name) === 'id' && only.initializer.kind === ts.SyntaxKind.TrueKeyword
}

/** Every `isDiscovered`/`isHidden` boolean-literal property found anywhere
 * inside a `where:` clause, at any nesting depth — the hand-rolled-filter
 * anti-pattern `visibleTo()` exists to replace. Deliberately does NOT flag
 * a write path (`data: { isDiscovered: true }`), only a filter. */
function findHandRolledDiscoveryFlags(sourceFile: ts.SourceFile): { line: number; text: string }[] {
  const violations: { line: number; text: string }[] = []

  function scanForFlags(node: ts.Node) {
    if (ts.isPropertyAssignment(node)) {
      const key = propertyName(node.name)
      if (
        key && DISCOVERY_FLAG_NAMES.has(key) &&
        (node.initializer.kind === ts.SyntaxKind.TrueKeyword || node.initializer.kind === ts.SyntaxKind.FalseKeyword)
      ) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        violations.push({ line: line + 1, text: node.getText(sourceFile) })
      }
    }
    ts.forEachChild(node, scanForFlags)
  }

  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === 'where') {
      scanForFlags(node.initializer)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
}

function readsGatedModel(source: string): boolean {
  const { calls, relationProps } = findGatedReads(parseFile('source.ts', source))
  return calls.length > 0 || relationProps.length > 0
}

const files = routeFiles(API_ROOT)
const gatedRoutes = files.filter(f => readsGatedModel(readFileSync(f, 'utf8')))

// #400: an IMPORT is not a call.
//
// This was `src.includes("from '@/lib/api/visibility'")` — so a route that
// imported visibleTo and never called it passed. The guard's whole claim
// is that fog of war is enforced "structurally, not by memory", and an
// import-string match is precisely enforcement by memory: it checks that
// someone remembered the module exists.
const usesHelper = (src: string) =>
  src.includes("from '@/lib/api/visibility'") && /\b(visibleTo|visibleToMany)\s*\(/.test(src)
const isAdminOnly = (src: string) =>
  /role\s*!==\s*(?:'ADMIN'|UserRole\.ADMIN)/.test(src) || /requireCampaignAdmin\(/.test(src)

describe('fog of war is enforced structurally, not by memory', () => {
  it('finds the routes that read fog-gated models at all', () => {
    // Guards the detector. If a refactor breaks these patterns, every case
    // below would pass vacuously by examining nothing.
    expect(gatedRoutes.length).toBeGreaterThan(5)
    expect(gatedRoutes.map(rel)).toContain('campaigns/[id]/route.ts')
  })

  it('gates every one of them, or exempts it on the record', () => {
    const unguarded = gatedRoutes
      .map(f => ({ path: rel(f), src: readFileSync(f, 'utf8') }))
      .filter(({ path }) => !(path in EXEMPT))
      .filter(({ src }) => !usesHelper(src) && !isAdminOnly(src))
      .map(({ path }) => path)

    expect(
      unguarded,
      `These routes read a fog-gated model (NPC/faction/location/clock) without ` +
      `visibleTo() from @/lib/api/visibility, and are not admin-only.\n` +
      `If the result reaches the client it must be gated. If it is an internal ` +
      `existence check, select only id and add it to EXEMPT in this file with ` +
      `the reason.\n  ${unguarded.join('\n  ')}`
    ).toEqual([])
  })

  it('holds exempt routes to reading nothing but ids', () => {
    // What stops EXEMPT becoming a place to hide a leak. An exemption is
    // "this never returns the row", so it stays true only while the reads
    // select id and nothing else. AST-based (#205): parses each gated
    // call's actual argument object rather than text-slicing to the next
    // `})`, which a nested object literal in the same call could fool.
    const leaky: string[] = []

    for (const [path, reason] of Object.entries(EXEMPT)) {
      const full = join(API_ROOT, path)
      const src = readFileSync(full, 'utf8')
      expect(reason.length, `${path} needs a real reason`).toBeGreaterThan(30)

      const { calls } = findGatedReads(parseFile(full, src))
      for (const { call } of calls) {
        if (!isIdOnlySelect(call)) {
          leaky.push(`${path}: a gated read without \`select: { id: true }\``)
        }
      }
    }

    expect(
      leaky,
      `An exempt route is reading more than an id from a fog-gated model. ` +
      `Either narrow the select, or gate the route properly and drop the ` +
      `exemption.\n  ${leaky.join('\n  ')}`
    ).toEqual([])
  })

  it('does not carry exemptions for routes that no longer exist', () => {
    // Self-pruning, same as the README symbol allowlist: a stale entry is a
    // hole waiting for a new file to be created at that path.
    const missing = Object.keys(EXEMPT).filter(p => !files.map(rel).includes(p))
    expect(missing, `Stale EXEMPT entries:\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('leaves no hand-rolled discovery clause outside the helper', () => {
    // The point of the refactor. A route writing its own `isDiscovered:
    // true` is a route that could just as easily write `false`, or use it
    // on a clock, where the polarity is inverted. AST-based (#205): walks
    // every `where:` clause's real object-literal structure at any nesting
    // depth, rather than a text window that only incidentally worked for
    // one-level-deep where objects — a real, deliberate strengthening, not
    // just a port. Write paths legitimately SET these flags; only filters
    // (a boolean literal inside a `where:`) are at issue.
    const handRolled = gatedRoutes
      .map(f => ({ path: rel(f), src: readFileSync(f, 'utf8'), file: f }))
      .filter(({ src, file }) => findHandRolledDiscoveryFlags(parseFile(file, src)).length > 0)
      .map(({ path }) => path)

    expect(
      handRolled,
      `These routes filter on a discovery flag directly instead of using ` +
      `visibleTo(). The helper exists because clocks gate on isHidden while ` +
      `everything else gates on isDiscovered — opposite polarity, easy to ` +
      `copy wrong.\n  ${handRolled.join('\n  ')}`
    ).toEqual([])
  })
})

// #205: confirms the AST detector actually works, rather than trivially
// passing because nothing in the real fixture ever exercises the cases it
// was built to catch — same discipline as
// worldUpdaters/__tests__/entityResolutionConvention.test.ts. Each of these
// specifically reproduces a shape the OLD regex-based detector was named as
// missing (computed access, a query method outside its fixed 3-method
// list), so this is a real regression test for #205, not just a smoke test.
describe('AST-based gated-read detection catches what the old regex could not', () => {
  it('detects a computed/bracket model access (prisma["nPC"].findMany)', () => {
    const src = `await prisma['nPC'].findMany({ where: { campaignId } })`
    expect(readsGatedModel(src)).toBe(true)
  })

  it('detects a query method outside the old fixed 3-method list (groupBy)', () => {
    const src = `await prisma.faction.groupBy({ by: ['archetype'] })`
    expect(readsGatedModel(src)).toBe(true)
  })

  it('still detects the plain dotted form (prisma.nPC.findMany)', () => {
    const src = `await prisma.nPC.findMany({ where: { campaignId } })`
    expect(readsGatedModel(src)).toBe(true)
  })

  it('still detects a nested-relation read (npcs: { where: ... })', () => {
    const src = `
      await prisma.campaign.findUnique({
        where: { id },
        include: { npcs: { where: { isDiscovered: true } } },
      })
    `
    expect(readsGatedModel(src)).toBe(true)
  })

  it('does not flag an unrelated model or a non-gated method', () => {
    expect(readsGatedModel(`await prisma.campaign.findMany({})`)).toBe(false)
    expect(readsGatedModel(`await prisma.nPC.create({ data: {} })`)).toBe(false)
    expect(readsGatedModel(`await prisma.nPC.update({ where: { id }, data: {} })`)).toBe(false)
  })

  it('recognizes an id-only select and rejects one that returns more', () => {
    const gated = findGatedReads(parseFile('s.ts', `
      const a = await prisma.nPC.findFirst({ where: { name }, select: { id: true } });
      const b = await prisma.faction.findFirst({ where: { name }, select: { id: true, name: true } });
    `))
    expect(gated.calls).toHaveLength(2)
    expect(isIdOnlySelect(gated.calls[0].call)).toBe(true)
    expect(isIdOnlySelect(gated.calls[1].call)).toBe(false)
  })

  it('finds a hand-rolled discovery flag at any nesting depth inside where, never in data', () => {
    const oneLevel = findHandRolledDiscoveryFlags(parseFile('s.ts', `
      await prisma.nPC.findMany({ where: { campaignId, isDiscovered: true } })
    `))
    expect(oneLevel).toHaveLength(1)

    const nested = findHandRolledDiscoveryFlags(parseFile('s.ts', `
      await prisma.faction.findMany({ where: { AND: [{ campaignId }, { isDiscovered: false }] } })
    `))
    expect(nested).toHaveLength(1)

    const writePathOnly = findHandRolledDiscoveryFlags(parseFile('s.ts', `
      await prisma.nPC.update({ where: { id }, data: { isDiscovered: true } })
    `))
    expect(writePathOnly).toHaveLength(0)

    const viaHelper = findHandRolledDiscoveryFlags(parseFile('s.ts', `
      await prisma.nPC.findMany({ where: { campaignId, ...visibleTo('npc', role) } })
    `))
    expect(viaHelper).toHaveLength(0)
  })
})

describe('visibleTo', () => {
  it('lifts the fog for an admin', () => {
    for (const model of FOG_GATED_MODELS) {
      expect(visibleTo(model, 'ADMIN')).toEqual({})
    }
  })

  it('reveals only discovered entities to a player', () => {
    expect(visibleTo('npc', 'PLAYER')).toEqual({ isDiscovered: true })
    expect(visibleTo('faction', 'PLAYER')).toEqual({ isDiscovered: true })
    expect(visibleTo('location', 'PLAYER')).toEqual({ isDiscovered: true })
  })

  it('gets the clock polarity right', () => {
    // The specific mistake this helper exists to prevent: clocks hide
    // behind isHidden, not isDiscovered, and the value that means visible
    // is false rather than true.
    expect(visibleTo('clock', 'PLAYER')).toEqual({ isHidden: false })
  })

  it('fails closed for a missing or unrecognised role', () => {
    // The failure mode of guessing generously is showing a player the GM's
    // hidden clocks.
    for (const role of [null, undefined, '', 'PLAYER', 'OWNER', 'admin']) {
      expect(visibleTo('npc', role as string), String(role)).toEqual({ isDiscovered: true })
    }
  })

  it('never returns an empty filter for a non-admin, whatever it is asked', () => {
    // The invariant underneath all of the above: {} means "no restriction",
    // and a non-admin must never receive one.
    for (const model of [...FOG_GATED_MODELS, 'nonsense' as never]) {
      expect(Object.keys(visibleTo(model, 'PLAYER')).length, String(model)).toBeGreaterThan(0)
    }
  })
})
