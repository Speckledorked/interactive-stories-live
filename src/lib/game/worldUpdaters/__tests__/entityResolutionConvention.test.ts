// src/lib/game/worldUpdaters/__tests__/entityResolutionConvention.test.ts
//
// A mechanical guard for the Phase 0 relationship-orphan bug's actual
// signature: an applier reading an AI-supplied `entity_id` field WITHOUT
// passing it through resolveEntityByNameOrId first. This repo has no
// ESLint installed at all (no config, no dependency — `next lint` has
// never been run), so a custom ESLint rule isn't a small addition here, it
// would mean standing up an entire new tool. This gets the same guarantee
// today, at zero new dependencies, using the TypeScript compiler API
// (already a dependency) to walk the real AST rather than grep — a
// text-based check would be too fragile to trust as a gate.
//
// Every OTHER applier in this directory follows the convention this
// enforces (npcs.ts, factions.ts, quests.ts all resolve via
// resolveEntityByNameOrId before using an AI-reported name/id as a lookup
// key) — characters.ts's relationship_changes handling was the one
// exception, and this is what would have caught it before it shipped.
//
// #239 (adversarial audit): this file's own header comment used to claim
// locations.ts already followed this convention too. It didn't —
// locations.ts matched AI-reported location names with a raw
// case-insensitive `findFirst` and auto-created on any miss, with no
// ambiguity detection at all (fixed separately, see #235 and
// locations.ts's own header comment). Worse, this guard's mechanism
// couldn't have caught that even if the claim had been checked: it only
// scans for the literal property name `entity_id`, and locations.ts's
// bypass read `.name`/`.location` instead — a different property name
// entirely. `entity_id` is safe to blanket-guard this way because it has
// exactly one real use in this codebase (an AI-reported lookup key); the
// second describe() block below adds a narrower, purpose-built check for
// the Location-specific pattern instead of broadening
// GUARDED_PROPERTY_NAMES to `name`/`location` — both of those properties
// have many legitimate non-lookup uses in this directory (condition
// checks, free-text field assignment, logging an already-resolved row's
// own name), so guarding them the same blunt way `entity_id` is guarded
// would flag that legitimate code as violations instead of adding signal.

import { describe, it, expect } from 'vitest'
import * as ts from 'typescript'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const WORLD_UPDATERS_DIR = join(__dirname, '..')
// The exact field the Phase 0 bug wrote unresolved. Deliberately narrow —
// broadening this to every `*_name_or_id` field would flag the correctly-
// resolved patterns everywhere else and make the check noise, not signal.
const GUARDED_PROPERTY_NAMES = new Set(['entity_id'])
const RESOLVER_CALL_NAME = 'resolveEntityByNameOrId'

interface Violation {
  file: string
  line: number
  text: string
}

function findViolations(filePath: string, sourceText: string): Violation[] {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, /* setParentNodes */ true)
  const violations: Violation[] = []

  function isArgumentOfResolverCall(node: ts.Node): boolean {
    let current: ts.Node | undefined = node
    while (current) {
      if (ts.isCallExpression(current) && current.arguments.includes(node as ts.Expression)) {
        return ts.isIdentifier(current.expression) && current.expression.text === RESOLVER_CALL_NAME
      }
      // Only walk up through expression wrappers (e.g. parenthesized), not
      // past a whole statement — we only care whether THIS specific
      // property access is itself an argument to the resolver, not
      // whether the resolver appears anywhere nearby in the function.
      if (ts.isCallExpression(current) || ts.isVariableDeclaration(current) || ts.isBinaryExpression(current)) {
        break
      }
      current = current.parent
    }
    return false
  }

  // Logging a raw id for a human to read (a warning message, a console
  // line) is never the risk this check exists for — only USING it as a
  // lookup key or persisting it unresolved is. Template-literal
  // interpolation is this codebase's actual display idiom throughout
  // worldUpdaters/, so excluding it is what keeps this check to real
  // signal instead of flagging every warn/log line that mentions an id.
  function isInsideTemplateInterpolation(node: ts.Node): boolean {
    let current: ts.Node | undefined = node
    while (current) {
      if (ts.isTemplateSpan(current)) return true
      current = current.parent
    }
    return false
  }

  function visit(node: ts.Node) {
    if (
      ts.isPropertyAccessExpression(node) &&
      GUARDED_PROPERTY_NAMES.has(node.name.text) &&
      !isArgumentOfResolverCall(node) &&
      !isInsideTemplateInterpolation(node)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      violations.push({ file: filePath, line: line + 1, text: node.getText(sourceFile) })
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
}

describe('worldUpdaters entity-resolution convention', () => {
  it('never reads an AI-supplied entity_id except as a direct argument to resolveEntityByNameOrId', () => {
    const files = readdirSync(WORLD_UPDATERS_DIR).filter((f) => f.endsWith('.ts') && !f.includes('__tests__'))
    expect(files.length).toBeGreaterThan(0) // sanity: the directory scan itself works

    const allViolations: Violation[] = []
    for (const file of files) {
      const fullPath = join(WORLD_UPDATERS_DIR, file)
      const source = readFileSync(fullPath, 'utf-8')
      allViolations.push(...findViolations(fullPath, source))
    }

    if (allViolations.length > 0) {
      const details = allViolations.map((v) => `  ${v.file}:${v.line} — ${v.text}`).join('\n')
      throw new Error(
        `Found entity_id read(s) not resolved via resolveEntityByNameOrId — this is exactly the shape of the ` +
        `Phase 0 relationship-orphan bug (an id-keyed map written from a raw AI-supplied string):\n${details}`
      )
    }
  })

  // Confirms the check itself actually works, rather than trivially
  // passing because nothing in the fixture ever matches.
  it('flags a synthetic file reproducing the original bug pattern', () => {
    const buggy = `
      for (const relChange of changes) {
        const entityId = relChange.entity_id
        map[entityId] = { trust: 1 }
      }
    `
    expect(findViolations('synthetic.ts', buggy)).toHaveLength(1)
  })

  it('does not flag the real, fixed pattern: entity_id passed straight into the resolver', () => {
    const fixed = `
      const relResolution = resolveEntityByNameOrId(npcsForResolution, relChange.entity_id)
    `
    expect(findViolations('synthetic.ts', fixed)).toHaveLength(0)
  })
})

// #235/#239: locations.ts used to be the one AI write-back entity type
// with its own private, unguarded Location lookup/creation path — a raw
// case-insensitive `findFirst` with no ambiguity detection, auto-creating
// a new row on any miss. That's fixed in locations.ts itself now (it
// resolves via resolveEntityByNameOrId/resolveOrCreateLocationId, same as
// every other entity type). This guard exists so nothing else in this
// directory can quietly reintroduce a second, unguarded Location lookup
// path outside locations.ts — the actual mechanical shape of the bug,
// rather than trying to stretch the property-name guard above onto
// `.name`/`.location`, which would flag legitimate, unrelated code (see
// the file header comment).
const LOCATION_PRISMA_METHODS = new Set(['findFirst', 'findUnique', 'findMany', 'create'])
// One documented, deliberate exception: characters.ts's
// checkLocationEntryGate does its own raw exact-string `findUnique` to
// check a corruption/condition gate on movement. It's explicitly fail-open
// by design (see its own doc comment — a missing/ambiguous location just
// means "no gate applies," never a row creation or an id being trusted as
// a match), read-only, and never creates or links a row. It isn't the
// entity-identity-duplication bug class this guard exists to prevent, so
// it's a named, allowed exception rather than something the guard is
// blind to by construction.
const ALLOWED_DIRECT_LOCATION_ACCESS: Record<string, string[]> = {
  'characters.ts': ['checkLocationEntryGate'],
}

function findDirectLocationAccessViolations(filePath: string, sourceText: string): Violation[] {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, /* setParentNodes */ true)
  const violations: Violation[] = []
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath
  const allowedFns = new Set(ALLOWED_DIRECT_LOCATION_ACCESS[fileName] ?? [])

  function isInsideAllowedFunction(node: ts.Node): boolean {
    let current: ts.Node | undefined = node
    while (current) {
      if (
        (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current)) &&
        current.name &&
        allowedFns.has(current.name.text)
      ) {
        return true
      }
      current = current.parent
    }
    return false
  }

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      LOCATION_PRISMA_METHODS.has(node.expression.name.text) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === 'location' &&
      !isInsideAllowedFunction(node)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      violations.push({ file: filePath, line: line + 1, text: node.expression.getText(sourceFile) })
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
}

describe('worldUpdaters Location resolution convention', () => {
  it('never calls tx.location.find*/create directly outside locations.ts, except the documented fail-open gate check', () => {
    const files = readdirSync(WORLD_UPDATERS_DIR).filter(
      (f) => f.endsWith('.ts') && !f.includes('__tests__') && f !== 'locations.ts'
    )
    expect(files.length).toBeGreaterThan(0) // sanity: the directory scan itself works

    const allViolations: Violation[] = []
    for (const file of files) {
      const fullPath = join(WORLD_UPDATERS_DIR, file)
      const source = readFileSync(fullPath, 'utf-8')
      allViolations.push(...findDirectLocationAccessViolations(fullPath, source))
    }

    if (allViolations.length > 0) {
      const details = allViolations.map((v) => `  ${v.file}:${v.line} — ${v.text}`).join('\n')
      throw new Error(
        `Found a direct tx.location.find*/create call outside locations.ts — this is the exact shape of the ` +
        `#235 bug (Location identity resolved by a bespoke, unguarded lookup instead of the shared resolver):\n${details}`
      )
    }
  })

  it('flags a synthetic file reproducing the original bypass pattern', () => {
    const buggy = `
      async function applySomethingElse(tx: Db, campaignId: string, name: string) {
        const existing = await tx.location.findFirst({ where: { campaignId, name: { equals: name, mode: 'insensitive' } } })
        return existing
      }
    `
    expect(findDirectLocationAccessViolations('somethingElse.ts', buggy)).toHaveLength(1)
  })

  it('does not flag the documented exception (checkLocationEntryGate)', () => {
    const allowed = `
      async function checkLocationEntryGate(tx: Db, campaignId: string, locationName: string) {
        const location = await tx.location.findUnique({ where: { campaignId_name: { campaignId, name: locationName } } })
        return location
      }
    `
    expect(findDirectLocationAccessViolations('characters.ts', allowed)).toHaveLength(0)
  })

  it('does not flag ordinary property reads of an already-resolved location (e.g. giver.location)', () => {
    const benign = `
      if (giver?.location && !checkConditionGate(giver.location).allowed) {
        return { allowed: false }
      }
    `
    expect(findDirectLocationAccessViolations('quests.ts', benign)).toHaveLength(0)
  })
})
