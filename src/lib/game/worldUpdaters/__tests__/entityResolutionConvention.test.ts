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
// Every OTHER applier in this directory already follows the convention
// this enforces (npcs.ts, factions.ts, locations.ts, quests.ts all resolve
// via resolveEntityByNameOrId before using an AI-reported name/id as a
// lookup key) — characters.ts's relationship_changes handling was the one
// exception, and this is what would have caught it before it shipped.

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
