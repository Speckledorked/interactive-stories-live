// src/lib/game/worldUpdaters/__tests__/guardedWriteConvention.test.ts
//
// #279/#307/#325: capabilities.ts's campaignCapability creation and
// friends/requests/route.ts's FriendRequest creation were both a bare
// check-then-create against a real DB @@unique constraint, unlike every
// sibling creator (NPC, Faction, Quest, wakeTick.ts's ActiveWake,
// economyTick.ts's FactionDebt) — all of which wrap the exact same
// check-then-create shape in isUniqueConstraintViolation()
// (uniqueConstraintGuard.ts), specifically because a "should never
// collide" create running inside a shared transaction (stateUpdater.ts's
// single $transaction for worldUpdaters, or a plain Prisma call for the
// friends routes) takes down everything else in that transaction/request
// if the constraint it should never hit fires anyway. Two independent
// instances of the same missing-guard gap (#279 for capabilities, #307 for
// friend requests) is exactly the kind of drift #205/#297/#312/#321
// already found elsewhere in this codebase — same fix as those: a
// structural guard, not a hope that the next new creator remembers to
// copy the pattern.
//
// Deliberately NOT a codebase-wide "every .create() needs a guard" rule.
// Most creates in this codebase have no realistic collision risk at all
// (a row scoped to one character, one request, one already-locked
// resource) — wrapping those in a try/catch that can never fire would be
// noise, not safety. This check is scoped to the specific files and
// models where a real DB @@unique constraint sits behind a check-then-act
// sequence that can run concurrently (two scenes for the same campaign
// resolving at once, two open tabs sending the same friend request) —
// the same narrow-scope reasoning promptQueryBounds.test.ts
// (unbounded-query check) and livingRosterConvention.test.ts
// (isAlive-gating check) already established for their own metas.
//
// AST-based, matching this repo's established fogOfWar.test.ts /
// entityResolutionConvention.test.ts / promptQueryBounds.test.ts /
// livingRosterConvention.test.ts convention (TypeScript compiler API — no
// ESLint installed here).

import { describe, it, expect } from 'vitest'
import * as ts from 'typescript'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..')

/**
 * Files with a check-then-create against a real DB @@unique constraint
 * that can run concurrently with itself. Add an entry (file + the
 * specific model, not every model the file happens to create) if another
 * write path gains this same shape — do not add a file wholesale without
 * naming which model actually has the collision risk, or this check
 * degrades into exactly the blanket rule the header above says not to be.
 */
//
// #400: this was a hardcoded seven-file allowlist, and the escape hatch
// was "write it in file #8". A guard whose scope is a list of the files
// that had the bug last time is a regression test wearing the name of an
// invariant — the next occurrence lands one directory over and the guard
// reports green.
//
// It is now a DIRECTORY WALK: every file under src/ is scanned for a
// create against one of GUARDED_MODELS, so the eighth file is in scope the
// moment it exists. The list below is retained only as documentation of
// where this shape is currently known to live.
const GUARDED_WRITE_FILES = [
  'src/lib/game/worldUpdaters/npcs.ts',
  'src/lib/game/worldUpdaters/quests.ts',
  'src/lib/game/worldUpdaters/factions.ts',
  'src/lib/game/tick/wakeTick.ts',
  'src/lib/game/tick/economyTick.ts',
  'src/lib/game/capabilities.ts',
  'src/app/api/friends/requests/route.ts',
]

/** Every .ts file under src/, excluding tests. */
function allSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : allSourceFiles(full)
    return entry.name.endsWith('.ts') && !entry.name.includes('.test.') ? [full] : []
  })
}

/**
 * #400: the real scope — every source file, not a list of the seven that
 * had the bug. Returns repo-relative paths so failures read the same way
 * the old allowlist did.
 */
function filesToScan(): string[] {
  return allSourceFiles(join(REPO_ROOT, 'src')).map((f) => f.slice(REPO_ROOT.length + 1))
}

/**
 * The specific Prisma model property names known to sit behind a real
 * @@unique constraint in one of the files above. Deliberately excludes,
 * e.g., capabilities.ts's own `characterCapability.create` calls — those
 * are per-character join rows with no analogous cross-scene collision risk,
 * not an oversight.
 */
const GUARDED_MODELS = new Set(['nPC', 'quest', 'faction', 'activeWake', 'factionDebt', 'campaignCapability', 'friendRequest'])

/**
 * Files/models allowed to skip the guard, with the reason. Empty today:
 * every current guarded-model create in GUARDED_WRITE_FILES already wraps
 * itself. Add an entry here (with the reasoning) rather than silencing the
 * check inline if a future write genuinely can't collide (e.g. it's
 * already inside another guard's catch block, or the model gained a
 * different concurrency-safe write pattern like a guarded updateMany).
 */
const EXEMPT: Record<string, string> = {}

function findEnclosingTry(node: ts.Node): ts.TryStatement | null {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isTryStatement(current)) return current
    current = current.parent
  }
  return null
}

function catchGuardsUniqueViolation(tryStmt: ts.TryStatement, sourceFile: ts.SourceFile): boolean {
  return !!tryStmt.catchClause && tryStmt.catchClause.getText(sourceFile).includes('isUniqueConstraintViolation')
}

interface Violation {
  line: number
  model: string
}

function findUnguardedCreates(filePath: string, source: string): Violation[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const violations: Violation[] = []

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'create') {
        const modelAccess = callee.expression
        if (ts.isPropertyAccessExpression(modelAccess) && GUARDED_MODELS.has(modelAccess.name.text)) {
          const tryStmt = findEnclosingTry(node)
          if (!tryStmt || !catchGuardsUniqueViolation(tryStmt, sourceFile)) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            violations.push({ line: line + 1, model: modelAccess.name.text })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations
}

describe('check-then-create writes against a real @@unique constraint stay guarded (#279, #307, #325)', () => {
  it('finds the files it means to check', () => {
    for (const file of GUARDED_WRITE_FILES) {
      expect(() => readFileSync(join(REPO_ROOT, file), 'utf8')).not.toThrow()
    }
  })

  it('every guarded-model create ANYWHERE under src/ is wrapped in isUniqueConstraintViolation', () => {
    // #400: scans the whole tree, not seven named files. The old escape
    // hatch was "write it in file #8".
    const violations: string[] = []
    for (const file of filesToScan()) {
      const full = join(REPO_ROOT, file)
      const src = readFileSync(full, 'utf8')
      for (const v of findUnguardedCreates(full, src)) {
        const key = `${file}#${v.model}`
        if (key in EXEMPT) continue
        violations.push(`${file}:${v.line} — ${v.model}.create has no isUniqueConstraintViolation guard`)
      }
    }

    expect(
      violations,
      `A check-then-create write against a model with a real DB @@unique ` +
      `constraint isn't wrapped in isUniqueConstraintViolation(), unlike every ` +
      `sibling creator. If this create genuinely can't collide, add it to this ` +
      `file's EXEMPT map with the reason instead of leaving it unguarded.\n  ${violations.join('\n  ')}`
    ).toEqual([])
  })

  it('does not carry exemptions for file/model pairs no longer in scope', () => {
    const inScope = new Set(filesToScan())
    const missing = Object.keys(EXEMPT).filter((k) => !inScope.has(k.split('#')[0]))
    expect(missing, `Stale EXEMPT entries:\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('scans materially more than the old seven-file allowlist', () => {
    // Guards the fix itself: if filesToScan ever silently narrows back to
    // a handful of files, the invariant quietly stops being enforced
    // everywhere and nothing else would notice.
    expect(filesToScan().length).toBeGreaterThan(GUARDED_WRITE_FILES.length * 10)
  })
})

describe('AST-based guarded-create detection', () => {
  it('flags a guarded-model create with no try/catch at all', () => {
    expect(findUnguardedCreates('s.ts', `
      await tx.nPC.create({ data: { campaignId, name } })
    `)).toHaveLength(1)
  })

  it('flags a create wrapped in try/catch whose catch does not check isUniqueConstraintViolation', () => {
    expect(findUnguardedCreates('s.ts', `
      try {
        await tx.faction.create({ data: { campaignId, name } })
      } catch (error) {
        console.error(error)
      }
    `)).toHaveLength(1)
  })

  it('does not flag a create guarded with the "if (!guard) throw" style', () => {
    expect(findUnguardedCreates('s.ts', `
      try {
        await tx.quest.create({ data: { campaignId, name } })
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error
        console.warn('collided')
      }
    `)).toHaveLength(0)
  })

  it('does not flag a create guarded with the "if (guard) continue" style', () => {
    expect(findUnguardedCreates('s.ts', `
      for (const x of xs) {
        try {
          await ctx.db.activeWake.create({ data: { campaignId } })
        } catch (error) {
          if (isUniqueConstraintViolation(error)) continue
          throw error
        }
      }
    `)).toHaveLength(0)
  })

  it('does not flag a model outside the curated GUARDED_MODELS set', () => {
    expect(findUnguardedCreates('s.ts', `
      await db.characterCapability.create({ data: { characterId, capabilityId } })
    `)).toHaveLength(0)
  })

  it('does not flag a non-create call on a guarded model', () => {
    expect(findUnguardedCreates('s.ts', `
      await tx.nPC.update({ where: { id }, data: { name } })
    `)).toHaveLength(0)
  })
})
