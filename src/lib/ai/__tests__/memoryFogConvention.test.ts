// src/lib/ai/__tests__/memoryFogConvention.test.ts
//
// #440: every raw query against campaign_memories uses the SHARED fog and
// archive predicates.
//
// The root cause this exists for is not "one query was wrong". It is that
// MEMORY_FOG_PREDICATE was introduced, applied to the two paths someone
// happened to be editing, and nothing recorded which paths must use it.
// Three call sites, one shared guard, two adopters — and the third was
// invisible, because nothing anywhere said it should be there.
//
// retrieveNpcHistory was the one left out, and it was the worst one to miss:
// it fires for guaranteed recall the moment a player NAMES an NPC, so it is
// the most directly reachable from player-authored text. It carried a
// bespoke single-id discovery check that confirmed the named NPC was
// discovered and said nothing about the other entities in the same memory —
// so a memory involving discovered Vell and an undiscovered faction came
// back the instant a player wrote "I ask Vell about it".
//
// A shared predicate with voluntary adoption is a convention, and this
// repo's answer to conventions is a structural guard. Same family as
// fogOfWar, promptQueryBounds, guardedWriteConvention and capOrdering.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const AI_DIR = join(process.cwd(), 'src', 'lib', 'ai')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full)
    }
    return entry.endsWith('.ts') && !entry.endsWith('.d.ts') ? [full] : []
  })
}

/**
 * Raw SQL template literals that read from campaign_memories.
 *
 * Matched on the FROM clause rather than on the function name, so a new
 * helper with a new name is covered the moment it is written.
 */
function memoryQueries(source: string): string[] {
  const queries: string[] = []
  // $queryRaw / $queryRawUnsafe / $executeRaw template bodies.
  const re = /\$(?:query|execute)Raw(?:Unsafe)?<[^>]*>?`([\s\S]*?)`|\$(?:query|execute)Raw(?:Unsafe)?`([\s\S]*?)`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    const body = m[1] ?? m[2] ?? ''
    if (/\bFROM\s+campaign_memories\b/i.test(body)) queries.push(body)
  }
  return queries
}

describe('every campaign_memories query uses the shared predicates (#440)', () => {
  const files = sourceFiles(AI_DIR).map((file) => ({ file, source: readFileSync(file, 'utf-8') }))

  it('finds the queries it is meant to be guarding', () => {
    // A guard that matches nothing passes forever. This is the check that
    // the matcher still works after any refactor of how these are written.
    const total = files.reduce((n, f) => n + memoryQueries(f.source).length, 0)
    expect(total).toBeGreaterThanOrEqual(2)
  })

  it('has no query that skips the fog predicate', () => {
    const offenders: string[] = []
    for (const { file, source } of files) {
      for (const body of memoryQueries(source)) {
        // An explicit, written-down exemption. A query that genuinely must
        // not be fog-filtered (an admin view, a migration) says so here.
        if (/memory-fog-exempt:/.test(body)) continue
        if (!/MEMORY_FOG_PREDICATE/.test(body)) {
          offenders.push(`${file.replace(process.cwd() + '/', '')}: ${body.trim().slice(0, 80)}…`)
        }
      }
    }

    expect(
      offenders,
      'A raw query against campaign_memories that does not use MEMORY_FOG_PREDICATE will ' +
      'return memories involving undiscovered NPCs and factions. A bespoke discovery check ' +
      'is not equivalent — the one this guard was written for checked only the NPC the ' +
      'caller named, and let every other entity in the same memory through. Use the shared ' +
      'predicate, or mark the query "memory-fog-exempt:" with a reason.\n  ' + offenders.join('\n  ')
    ).toEqual([])
  })

  it('has no query that returns archived memories', () => {
    // #392 archives instead of deleting. The semantic path excludes them
    // implicitly (archived rows have no embedding and the CTE requires one),
    // but any path that does not go through that CTE has to say so — and
    // retrieveNpcHistory did not, so consolidation retired a memory from
    // search while leaving it live there.
    const offenders: string[] = []
    for (const { file, source } of files) {
      for (const body of memoryQueries(source)) {
        if (/memory-archive-exempt:/.test(body)) continue
        // A literal `"archivedAt" IS NULL` counts too — the consolidation
        // pass writes it inline because it is not a Prisma.sql consumer.
        const excludesArchived =
          /MEMORY_LIVE_PREDICATE/.test(body) ||
          /embedding\s+IS\s+NOT\s+NULL/i.test(body) ||
          /"archivedAt"\s+IS\s+NULL/i.test(body)
        if (!excludesArchived) {
          offenders.push(`${file.replace(process.cwd() + '/', '')}: ${body.trim().slice(0, 80)}…`)
        }
      }
    }

    expect(
      offenders,
      'A raw query against campaign_memories that neither uses MEMORY_LIVE_PREDICATE nor ' +
      'requires a non-null embedding will return rows consolidation has deliberately ' +
      'retired.\n  ' + offenders.join('\n  ')
    ).toEqual([])
  })

  it('nothing invents a similarity score of 1.0', () => {
    // retrieveNpcHistory hardcoded `1.0 as similarity`, which bypassed the
    // minSimilarity floor AND outranked every real match in the
    // importance-boosted re-sort. A fabricated perfect score is worse than
    // no score: it wins.
    const offenders: string[] = []
    for (const { file, source } of files) {
      for (const body of memoryQueries(source)) {
        if (/\b1(?:\.0+)?\s+as\s+similarity/i.test(body)) {
          offenders.push(file.replace(process.cwd() + '/', ''))
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
