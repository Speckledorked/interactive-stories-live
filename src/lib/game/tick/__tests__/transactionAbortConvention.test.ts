// src/lib/game/tick/__tests__/transactionAbortConvention.test.ts
//
// #441: no tick handler may swallow a database error and keep going.
//
// Every handler runs on `ctx.db`, the ONE Prisma.TransactionClient shared
// by the whole tick (worldTick.ts wraps the handler pass in a single
// `prisma.$transaction`). In Postgres a statement that raises inside a
// transaction puts the transaction into an aborted state, and Prisma opens
// no per-statement savepoint — so there is nothing to roll back to and
// every subsequent statement fails with "current transaction is aborted".
//
// That makes catch-and-continue around a write actively worse than not
// catching at all. It reads as "this failure was benign, carry on", and
// what actually happens is that the rest of the world turn dies. Three
// sites had it — two in wakeTick, one in economyTick, whose own comment
// said it was copying "the same swallow-and-skip pattern this file already
// uses". The pattern propagated because it looks correct.
//
// The safe expression of the same intent is `createMany({ skipDuplicates:
// true })`, which compiles to ON CONFLICT DO NOTHING and never raises.
//
// This is a source-shape guard in the same family as capOrdering.convention,
// guardedWriteConvention and zeroAiBoundary: the invariant is real, it is
// invisible at the call site, and nothing else can see it.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const TICK_DIR = join(process.cwd(), 'src', 'lib', 'game', 'tick')

function tickHandlerSources(): Array<{ file: string; source: string }> {
  return readdirSync(TICK_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((file) => ({ file, source: readFileSync(join(TICK_DIR, file), 'utf-8') }))
}

/**
 * A `catch` block that continues or returns without rethrowing, anywhere a
 * write on the transaction client could have raised.
 *
 * Deliberately crude: it looks for `continue`/`return` inside a catch body
 * with no `throw`. A false positive is cheap to exempt with a comment; a
 * false negative is a lost world turn.
 */
function swallowingCatches(source: string): string[] {
  const found: string[] = []
  const lines = source.split('\n')

  for (let i = 0; i < lines.length; i++) {
    if (!/\}\s*catch\s*\(/.test(lines[i])) continue

    // Read the catch body by brace depth, counting from the `catch` keyword
    // onward. Starting at the beginning of the line counts the TRY block's
    // closing brace first, which drives depth to -1 and then back to 0 on
    // the catch's own opening brace — so the scan terminates on line one and
    // the body is never read. (This guard's own self-check caught that,
    // which is the entire reason the self-check is here.)
    let depth = 0
    let started = false
    const body: string[] = []
    for (let j = i; j < lines.length && j < i + 40; j++) {
      const from = j === i ? lines[j].indexOf('catch') : 0
      for (const ch of lines[j].slice(from)) {
        if (ch === '{') { depth++; started = true }
        else if (ch === '}') depth--
      }
      if (started) body.push(lines[j])
      if (started && depth <= 0) break
    }
    const text = body.join('\n')

    // Only a write on the TRANSACTION CLIENT can abort the tick. A catch
    // around `prisma.*` (the singleton) runs outside it — worldEventLog's
    // persistWorldEvents and tension.ts's refresh both do, deliberately,
    // and both are correct to swallow. Scanning the try body for `ctx.db.`
    // is what separates "this catch is fine" from "this catch kills the
    // turn", and it means genuinely-safe code needs no exemption comment.
    let tryStart = i
    for (let j = i; j >= 0 && j > i - 60; j--) {
      if (/\btry\s*\{/.test(lines[j])) { tryStart = j; break }
    }
    const tryBody = lines.slice(tryStart, i + 1).join('\n')
    if (!/\bctx\.db\./.test(tryBody)) continue

    // An explicit exemption, stated at the catch, opts a site out — the
    // same escape hatch the other convention guards use, but it has to be
    // written down next to the code it excuses.
    if (/tx-safe:/.test(text)) continue

    const swallows = /\b(continue|return)\b/.test(text)
    const rethrows = /\bthrow\b/.test(text)
    if (swallows && !rethrows) {
      found.push(`${lines[i].trim()} (line ${i + 1})`)
    }
  }
  return found
}

describe('tick handlers never swallow a DB error inside the shared transaction (#441)', () => {
  it('has no catch that continues or returns without rethrowing', () => {
    const offenders: string[] = []
    for (const { file, source } of tickHandlerSources()) {
      for (const site of swallowingCatches(source)) {
        offenders.push(`${file}: ${site}`)
      }
    }

    expect(
      offenders,
      'A catch that continues without rethrowing, around a write on the tick transaction, ' +
      'converts a benign constraint violation into total loss of the world turn — Postgres ' +
      'aborts the transaction and Prisma has no savepoint to recover to. Use ' +
      'createMany({ skipDuplicates: true }) (ON CONFLICT DO NOTHING, never raises), or if the ' +
      'catch genuinely cannot wrap a transactional write, mark it with a "tx-safe:" comment ' +
      'saying why.\n  ' + offenders.join('\n  ')
    ).toEqual([])
  })

  it('catches the pattern it exists to catch', () => {
    // Mutation check on the guard itself, not on the handlers — the exact
    // shape that was in wakeTick before this issue.
    const bad = `
      for (const x of xs) {
        try {
          await ctx.db.activeWake.create({ data: {} })
        } catch (error) {
          if (isUniqueConstraintViolation(error)) continue
        }
      }
    `
    expect(swallowingCatches(bad)).toHaveLength(1)
  })

  it('does not flag a catch that rethrows', () => {
    const good = `
        try {
          await ctx.db.activeWake.create({ data: {} })
        } catch (error) {
          if (isUniqueConstraintViolation(error)) continue
          throw error
        }
    `
    expect(swallowingCatches(good)).toHaveLength(0)
  })

  it('does not flag a catch around the prisma singleton, which is outside the tick tx', () => {
    // worldEventLog.ts and tension.ts both do this on purpose — they run
    // after the transaction commits, so swallowing is correct there.
    const outside = `
        try {
          await prisma.worldMeta.update({ where: {}, data: {} })
        } catch (error) {
          console.error('non-critical', error)
          return null
        }
    `
    expect(swallowingCatches(outside)).toHaveLength(0)
  })
})
