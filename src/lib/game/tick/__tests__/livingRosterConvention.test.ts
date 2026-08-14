// src/lib/game/tick/__tests__/livingRosterConvention.test.ts
//
// #312/#321/#327: factionTick.ts's decideDefection roster query silently
// omitted `isAlive: true` while every sibling tick handler in this same
// directory (leadershipTick.ts, npcDispositionTick.ts, migrationTick.ts,
// npcSocietyTick.ts, wakeTick.ts, informationTick.ts) already gates its
// campaign/faction-scoped NPC or Character roster read on it — a dead NPC
// still nominally attached to a collapsing faction got reassigned based on
// a frozen, no-longer-updating disposition value from the moment of death.
// A convention only enforced by everyone remembering to copy the sibling
// file correctly is exactly the class of drift #205/#297 already found
// twice elsewhere in this codebase (fog-of-war reads, unbounded queries),
// so — same fix as those — this is now a structural guard, not a hope.
//
// Deliberately scoped to this directory only, not a codebase-wide "every
// NPC/Character findMany needs isAlive" rule. Outside the tick pipeline,
// plenty of NPC/Character reads have no reason to exclude the dead:
// worldUpdaters/npcs.ts's own death-processing write, admin/history views,
// and anywhere resolving an AI-reported name against the full roster
// (excluding the dead there would just make a dead NPC's name silently
// fail to resolve, which is its own bug, not a fix). Inside
// src/lib/game/tick specifically, though, the convention really is this
// uniform — a *_findMany call for the tick's own turn-by-turn processing
// roster is either a "who's alive right now" read or a deliberate,
// explainable exception (wakeTick.ts's own `isAlive: false` query for
// newly-dead NPCs is exactly that: it isn't missing the key, it's just
// asking the opposite question on purpose — this check only flags the key
// being ABSENT, never which boolean it's set to).
//
// AST-based, matching this repo's established fogOfWar.test.ts /
// entityResolutionConvention.test.ts / promptQueryBounds.test.ts
// convention (TypeScript compiler API — no ESLint installed here).

import { describe, it, expect } from 'vitest'
import * as ts from 'typescript'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const TICK_ROOT = join(__dirname, '..')

/**
 * Files in this directory known to need a roster read that intentionally
 * omits `isAlive`, with the reason — same self-policing shape as
 * fogOfWar.test.ts's EXEMPT. Empty today: every current campaign/faction-
 * scoped NPC or Character read in this directory already gates on
 * `isAlive` one way or the other. Add an entry here (with the reasoning)
 * rather than silencing the check inline if a future handler genuinely
 * needs both the living and the dead in one query.
 */
const EXEMPT: Record<string, string> = {}

const ROSTER_MODELS = new Set(['nPC', 'character'])
const ROSTER_READ_METHODS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'groupBy', 'count',
])
const SCOPE_KEYS = new Set(['campaignId', 'factionId'])

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text
  return null
}

/** Walks an object literal at any nesting depth for any of the given keys
 * — matching fogOfWar.test.ts's scanForFlags so an AND/OR-wrapped key is
 * still found, not just a top-level one. */
function hasKeyAnywhere(node: ts.Node, keys: Set<string>): boolean {
  let found = false
  function visit(n: ts.Node) {
    if (found) return
    if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) {
      if (propertyName(n.name) && keys.has(propertyName(n.name)!)) {
        found = true
        return
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

function findWhereProp(argObj: ts.ObjectLiteralExpression): ts.PropertyAssignment | undefined {
  return argObj.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && propertyName(p.name) === 'where'
  )
}

/** Matches `ctx.db.nPC.findMany(...)` / `prisma.character.findMany(...)`
 * (PropertyAccessExpression chain) — the two db-access spellings this
 * directory's handlers actually use (a TickContext's injected `ctx.db`
 * inside a handler, or the shared `prisma` client in a plain helper like
 * wikiSync.ts's describeSocialTies). */
function rosterModelName(modelAccess: ts.Expression): string | null {
  if (!ts.isPropertyAccessExpression(modelAccess)) return null
  const name = modelAccess.name.text
  if (!ROSTER_MODELS.has(name)) return null

  const base = modelAccess.expression
  if (ts.isIdentifier(base) && base.text === 'prisma') return name
  if (
    ts.isPropertyAccessExpression(base) &&
    base.name.text === 'db' &&
    ts.isIdentifier(base.expression) &&
    base.expression.text === 'ctx'
  ) {
    return name
  }
  return null
}

interface Violation {
  line: number
  model: string
  method: string
}

function findUngatedRosterQueries(filePath: string, source: string): Violation[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const violations: Violation[] = []

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isPropertyAccessExpression(callee) && ROSTER_READ_METHODS.has(callee.name.text)) {
        const model = rosterModelName(callee.expression)
        if (model) {
          const arg = node.arguments[0]
          if (arg && ts.isObjectLiteralExpression(arg)) {
            const whereProp = findWhereProp(arg)
            const scoped =
              whereProp && ts.isObjectLiteralExpression(whereProp.initializer) && hasKeyAnywhere(whereProp.initializer, SCOPE_KEYS)
            const gated =
              whereProp && ts.isObjectLiteralExpression(whereProp.initializer) && hasKeyAnywhere(whereProp.initializer, new Set(['isAlive']))
            if (scoped && !gated) {
              const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              violations.push({ line: line + 1, model, method: callee.name.text })
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

function tickFiles(): string[] {
  // readdirSync on TICK_ROOT (not recursive) never lists into the
  // __tests__ subdirectory at all, so this only ever sees the handler
  // files themselves.
  return readdirSync(TICK_ROOT).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
}

describe('tick-pipeline NPC/Character roster reads stay isAlive-gated (#312, #321, #327)', () => {
  it('finds the files it means to check', () => {
    // Guards the guard: if this directory gets restructured, this test
    // would otherwise pass vacuously by checking nothing.
    const files = tickFiles()
    expect(files.length).toBeGreaterThan(10)
    expect(files).toContain('factionTick.ts')
    expect(files).toContain('wakeTick.ts')
  })

  it('every campaign/faction-scoped NPC or Character roster read has isAlive present', () => {
    const violations: string[] = []
    for (const file of tickFiles()) {
      if (file in EXEMPT) continue
      const full = join(TICK_ROOT, file)
      const src = readFileSync(full, 'utf8')
      for (const v of findUngatedRosterQueries(full, src)) {
        violations.push(`${file}:${v.line} — ${v.model}.${v.method} has no isAlive filter`)
      }
    }

    expect(
      violations,
      `A campaign/faction-scoped NPC or Character read in the tick pipeline has ` +
      `no isAlive filter, unlike every sibling roster query in this directory. ` +
      `If the dead genuinely belong in this particular read's result set, add ` +
      `it (with the reason) to this file's EXEMPT map instead of leaving the ` +
      `omission silent.\n  ${violations.join('\n  ')}`
    ).toEqual([])
  })

  it('does not carry exemptions for files that no longer exist', () => {
    const files = tickFiles()
    const missing = Object.keys(EXEMPT).filter((f) => !files.includes(f))
    expect(missing, `Stale EXEMPT entries:\n  ${missing.join('\n  ')}`).toEqual([])
  })
})

describe('AST-based roster-gating detection', () => {
  it('flags a campaignId-scoped nPC/character read missing isAlive', () => {
    expect(findUngatedRosterQueries('s.ts', `
      await ctx.db.nPC.findMany({ where: { campaignId: ctx.campaignId } })
    `)).toHaveLength(1)
    expect(findUngatedRosterQueries('s.ts', `
      await ctx.db.character.findMany({ where: { campaignId: ctx.campaignId } })
    `)).toHaveLength(1)
  })

  it('flags a factionId-scoped read missing isAlive (the real #321 bug shape)', () => {
    expect(findUngatedRosterQueries('s.ts', `
      const members = await ctx.db.nPC.findMany({
        where: { factionId: faction.id },
        select: { id: true, disposition: true },
      })
    `)).toHaveLength(1)
  })

  it('does not flag a read that includes isAlive, whichever boolean it is', () => {
    expect(findUngatedRosterQueries('s.ts', `
      await ctx.db.nPC.findMany({ where: { campaignId: ctx.campaignId, isAlive: true } })
    `)).toHaveLength(0)
    expect(findUngatedRosterQueries('s.ts', `
      await ctx.db.nPC.findMany({ where: { campaignId: ctx.campaignId, isAlive: false } })
    `)).toHaveLength(0)
  })

  it('finds isAlive nested inside AND/OR, not just top-level', () => {
    expect(findUngatedRosterQueries('s.ts', `
      await ctx.db.nPC.findMany({ where: { AND: [{ campaignId: ctx.campaignId }, { isAlive: true }] } })
    `)).toHaveLength(0)
  })

  it('recognizes both the ctx.db and plain prisma access spellings', () => {
    expect(findUngatedRosterQueries('s.ts', `
      await prisma.nPC.findMany({ where: { campaignId } })
    `)).toHaveLength(1)
    expect(findUngatedRosterQueries('s.ts', `
      await prisma.nPC.findMany({ where: { campaignId, isAlive: true } })
    `)).toHaveLength(0)
  })

  it('does not flag a read with no campaign/faction scoping at all', () => {
    expect(findUngatedRosterQueries('s.ts', `
      await ctx.db.nPC.findMany({ where: { id: { in: ids } } })
    `)).toHaveLength(0)
  })

  it('does not flag an unrelated model, a non-roster method, or a write', () => {
    expect(findUngatedRosterQueries('s.ts', `await ctx.db.location.findMany({ where: { campaignId } })`)).toHaveLength(0)
    expect(findUngatedRosterQueries('s.ts', `await ctx.db.nPC.update({ where: { id }, data: { campaignId } })`)).toHaveLength(0)
    expect(findUngatedRosterQueries('s.ts', `await ctx.db.nPC.create({ data: { campaignId } })`)).toHaveLength(0)
  })
})
