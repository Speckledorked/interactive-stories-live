// src/lib/ai/__tests__/promptQueryBounds.test.ts
//
// #297/#326: several campaign-scoped queries feeding the AI prompt/context
// pipeline used to fetch a growth-model's ENTIRE campaign history before
// either relevance-filtering or capForPrompt ever ran — query cost that
// scales with total campaign age/entity count, not campaign size at any
// given moment. Fixed in worldSummary.ts (NPC/faction fetch) and
// contextManager.ts (allScenes/timeline fetch) by adding a generous `take`
// backstop, ordered by the same relevance signal each caller already sorts
// by downstream.
//
// Deliberately NOT a codebase-wide "every campaignId-scoped findMany needs
// take" rule: a preview scan of every growth-model findMany/groupBy call
// in src/lib turned up 67 matches, and the overwhelming majority are
// correctness-critical full-roster reads (resolving an AI-reported name
// against the complete NPC/faction list — consequences.ts, stateUpdater.ts,
// worldUpdaters/quests.ts, world-state-tracker.ts, resolution.ts — or a tick
// handler that must consider every relevant entity, not a capped page of
// them) where adding `take` would be an actively dangerous change: an
// entity outside whatever page happened to be fetched would silently fail
// to match, not just be less prominent in a prompt. game/integrity/
// snapshot.ts's own header comment names this exact tradeoff explicitly for
// the Integrity Engine's read. So this file is a narrower, honest regression
// guard for the specific files where truncation IS safe (prompt-building/
// context-compression, where a relevance filter or capForPrompt already
// decides what actually matters, and a `take` backstop only ever protects
// against pathological growth, never changes normal-scale behavior) —
// not a blanket new-violation-hunting lint that would risk being reached
// for in the wrong place.
//
// AST-based (matching fogOfWar.test.ts / entityResolutionConvention.test.ts's
// established convention in this repo — no ESLint installed, the TypeScript
// compiler API is already a dependency) rather than a hardcoded line-number
// assertion, so it stays robust to refactors within these files and still
// catches a `take` accidentally dropped during a future edit.

import { describe, it, expect } from 'vitest'
import * as ts from 'typescript'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const AI_ROOT = join(__dirname, '..')

/**
 * Files known to fetch a growth-model's campaign history specifically to
 * feed the AI prompt or a compressed-context pipeline — the class of read
 * where relevance-based truncation is expected and safe. Add a new entry
 * here (with the same reasoning) if another prompt/context-building file
 * gains an unbounded per-campaign growth-model query; do NOT add a
 * correctness-critical roster-resolution file here without re-reading the
 * header comment above first.
 */
//
// #400: this was TWO files, and the escape hatch was "add a third". A
// guard whose scope is a list of the files that had the bug is a
// regression test wearing the name of an invariant.
//
// It is now every file under src/lib/ai — the whole directory IS the
// prompt/context-building layer, so scoping to it needs no list to
// maintain, and a new prompt builder is in scope the moment it exists.
const PROMPT_CONTEXT_FILES = ['worldSummary.ts', 'contextManager.ts']

/** Every non-test .ts file under src/lib/ai, recursively. */
function promptLayerFiles(dir: string = AI_ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : promptLayerFiles(full)
    return entry.name.endsWith('.ts') && !entry.name.includes('.test.') ? [full] : []
  })
}

const GROWTH_MODELS = new Set(['scene', 'timelineEvent', 'nPC', 'faction'])
const BOUNDED_METHODS = new Set(['findMany', 'groupBy'])

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text
  return null
}

/** Walks a `where:` object literal at any nesting depth for a campaignId
 * property — matching fogOfWar.test.ts's scanForFlags approach so an
 * `AND`/`OR`-wrapped campaignId is still found. */
function hasCampaignIdAnywhere(node: ts.Node): boolean {
  let found = false
  function visit(n: ts.Node) {
    if (found) return
    if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) {
      if (propertyName(n.name) === 'campaignId') {
        found = true
        return
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

function hasTopLevelTake(argObj: ts.ObjectLiteralExpression): boolean {
  return argObj.properties.some((p) => {
    if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) return false
    return propertyName(p.name) === 'take'
  })
}

function findWhereProp(argObj: ts.ObjectLiteralExpression): ts.PropertyAssignment | undefined {
  return argObj.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && propertyName(p.name) === 'where'
  )
}

interface Violation {
  line: number
  model: string
  method: string
}

function findUnboundedCampaignQueries(filePath: string, source: string): Violation[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const violations: Violation[] = []

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isPropertyAccessExpression(callee) && BOUNDED_METHODS.has(callee.name.text)) {
        const modelAccess = callee.expression
        if (ts.isPropertyAccessExpression(modelAccess) && GROWTH_MODELS.has(modelAccess.name.text)) {
          const arg = node.arguments[0]
          if (arg && ts.isObjectLiteralExpression(arg)) {
            const whereProp = findWhereProp(arg)
            const scoped =
              whereProp && ts.isObjectLiteralExpression(whereProp.initializer) && hasCampaignIdAnywhere(whereProp.initializer)
            if (scoped && !hasTopLevelTake(arg)) {
              const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              violations.push({ line: line + 1, model: modelAccess.name.text, method: callee.name.text })
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations
}

describe('prompt/context-building queries stay bounded (#297, #326)', () => {
  it('finds the files it means to check', () => {
    // Guards the guard: if these files get renamed/moved, this test would
    // otherwise pass vacuously by checking nothing.
    for (const file of PROMPT_CONTEXT_FILES) {
      expect(() => readFileSync(join(AI_ROOT, file), 'utf8')).not.toThrow()
    }
  })

  it('every campaign-scoped NPC/faction/scene/timeline read in the prompt layer has a take bound', () => {
    const violations: string[] = []
    for (const full of promptLayerFiles()) {
      const file = full.slice(AI_ROOT.length + 1)
      const src = readFileSync(full, 'utf8')
      for (const v of findUnboundedCampaignQueries(full, src)) {
        violations.push(`${file}:${v.line} — ${v.model}.${v.method} has no take bound`)
      }
    }

    expect(
      violations,
      `A campaign-scoped query in a prompt/context-building file has no ` +
      `take bound — this either reintroduces #297's unbounded-growth query ` +
      `cost, or (if it's now a correctness-critical full-roster read rather ` +
      `than a prompt-relevance read) belongs in a file NOT on this test's ` +
      `prompt layer at all, not with an unbounded query left here.\n  ${violations.join('\n  ')}`
    ).toEqual([])
  })
})

describe('AST-based unbounded-query detection', () => {
  it('flags a campaignId-scoped findMany/groupBy with no take', () => {
    expect(findUnboundedCampaignQueries('s.ts', `
      await prisma.nPC.findMany({ where: { campaignId } })
    `)).toHaveLength(1)
  })

  it('does not flag one with a take bound, however the value is expressed', () => {
    expect(findUnboundedCampaignQueries('s.ts', `
      await prisma.nPC.findMany({ where: { campaignId }, take: 500 })
    `)).toHaveLength(0)
    expect(findUnboundedCampaignQueries('s.ts', `
      await prisma.faction.findMany({ where: { campaignId }, take: someVariable })
    `)).toHaveLength(0)
  })

  it('finds campaignId nested inside AND/OR, not just top-level', () => {
    expect(findUnboundedCampaignQueries('s.ts', `
      await prisma.scene.findMany({ where: { AND: [{ campaignId }, { status: 'RESOLVED' }] } })
    `)).toHaveLength(1)
  })

  it('does not flag a query with no campaignId in where at all', () => {
    expect(findUnboundedCampaignQueries('s.ts', `
      await prisma.nPC.findMany({ where: { id: { in: ids } } })
    `)).toHaveLength(0)
  })

  it('does not flag an unrelated model or a non-bounded method', () => {
    expect(findUnboundedCampaignQueries('s.ts', `await prisma.character.findMany({ where: { campaignId } })`)).toHaveLength(0)
    expect(findUnboundedCampaignQueries('s.ts', `await prisma.nPC.create({ data: { campaignId } })`)).toHaveLength(0)
  })
})
