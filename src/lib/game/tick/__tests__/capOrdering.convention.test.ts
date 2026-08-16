// src/lib/game/tick/__tests__/capOrdering.convention.test.ts
// #375: a structural guard that the per-tick roster stays a TICK-level
// decision.
//
// The defect this replaces was invisible to every unit test in the repo,
// because every unit involved was individually correct. Each handler ran
// its own capped, rotation-ordered query and bumped lastTickedAt with the
// TRANSACTION client immediately afterwards — and Prisma transactions read
// their own writes, so handler N+1 selected a different slice than handler
// N. It only broke in composition.
//
// The property that makes that impossible is simple and checkable from
// source: no tick handler may cap or rotate its own entity query. If one
// does, this fails.
//
// Deliberately a source scan rather than a behavioural test. The
// behavioural version would need eleven handlers running against a real
// transaction to observe the interaction — which is worth having (see the
// idle-campaign integration test) but is not what catches a twelfth
// handler being added next quarter with the old pattern copied from its
// neighbours.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TICK_DIR = join(__dirname, '..')

/** The module that OWNS capping and rotation — it must do both. */
const OWNER = 'capOrdering.ts'

function tickHandlerSources(): Array<{ file: string; source: string }> {
  return readdirSync(TICK_DIR)
    .filter((f) => f.endsWith('.ts') && f !== OWNER)
    .map((file) => ({ file, source: readFileSync(join(TICK_DIR, file), 'utf8') }))
}

/** Strip comments so prose about the old pattern doesn't trip the scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

describe('tick handlers do not resolve their own entity roster (#375)', () => {
  it('no handler applies an entity cap with take:', () => {
    const offenders = tickHandlerSources()
      .filter(({ source }) => /take:\s*ctx\.(factionCap|npcCap)/.test(stripComments(source)))
      .map(({ file }) => file)

    expect(
      offenders,
      `These handlers re-derive their own capped slice. Capping is resolved once per tick in ` +
        `worldTick.ts (resolveTickRoster) and passed through ctx.roster — filter with ` +
        `rosterFactionFilter(ctx) / rosterNpcFilter(ctx) instead.`
    ).toEqual([])
  })

  it('no handler orders by the rotation key', () => {
    const offenders = tickHandlerSources()
      .filter(({ source }) => /TICK_ROTATION_ORDER|lastTickedAt/.test(stripComments(source)))
      .map(({ file }) => file)

    expect(
      offenders,
      `These handlers sort by the rotation key themselves. Two handlers sorting by ` +
        `lastTickedAt inside one transaction is exactly the bug: the second sees the ` +
        `first's bump and selects a different roster.`
    ).toEqual([])
  })

  it('no handler bumps the rotation key', () => {
    const offenders = tickHandlerSources()
      .filter(({ source }) => /markRosterTicked|markFactionsTicked|markNpcsTicked/.test(stripComments(source)))
      .map(({ file }) => file)

    expect(
      offenders,
      `Only worldTick.ts may bump lastTickedAt, once, after every handler has run.`
    ).toEqual([])
  })

  it('every handler that queries factions or NPCs either applies the roster filter or declares itself exempt', () => {
    const missing: string[] = []

    for (const { file, source } of tickHandlerSources()) {
      const code = stripComments(source)
      // Only the capped entity types are rostered. A handler that queries
      // locations, clocks or wars is unaffected.
      const queriesRosteredEntity =
        /ctx\.db\.faction\.findMany|ctx\.db\.nPC\.findMany/.test(code)
      if (!queriesRosteredEntity) continue

      const appliesFilter = /roster(Faction|Npc)Filter\(ctx\)/.test(code)
      // Some handlers legitimately operate on the FULL population — a
      // ripple that reaches every affected faction, information spreading
      // to every witness. Those declare it in the source with a
      // `roster-exempt:` marker and a reason.
      //
      // The marker lives in the handler, not in an allowlist here, on
      // purpose: an allowlist in a test file is a decision made far away
      // from the code it governs, and the next handler gets written by
      // copying its neighbour, not by reading this file.
      const declaresExemption = /roster-exempt:/.test(source)

      if (!appliesFilter && !declaresExemption) missing.push(file)
    }

    expect(
      missing,
      `These handlers query factions/NPCs without restricting to ctx.roster and without ` +
        `declaring a "roster-exempt: <reason>" marker, so they silently simulate a ` +
        `different population than the rest of the tick.`
    ).toEqual([])
  })
})
