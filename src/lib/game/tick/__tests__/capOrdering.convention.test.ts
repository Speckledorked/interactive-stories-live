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
import { basename, join } from 'node:path'

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

/**
 * #445: the handlers that genuinely simulate the FULL population.
 *
 * The exemption is deliberately TWO-PLACE: a `roster-exempt: <reason>` marker
 * in the handler, and an entry here. Either alone fails.
 *
 * The marker alone was the original design, and its reasoning was sound as far
 * as it went — "an allowlist in a test file is a decision made far away from
 * the code it governs, and the next handler gets written by copying its
 * neighbour, not by reading this file." That is exactly the problem: copying a
 * neighbour copies its exemption, and a guard whose escape hatch is a comment
 * is an allowlist nobody reviews. Five handlers had opted out with no single
 * place a reviewer could see the set.
 *
 * Requiring both keeps the reason beside the code AND makes opting out a
 * visible, deliberate edit to a list — and the stale-entry check below keeps
 * the list honest in the other direction.
 */
const ROSTER_EXEMPT_HANDLERS = new Set([
  // A wake ripples to everyone the death or collapse actually touched.
  'wakeTick.ts',
  // Information spreads to WITNESSES, not to a simulated subset.
  'informationTick.ts',
  // Population movement is location-driven.
  'migrationTick.ts',
  // Loyalty is a property of a LOCATION and its owner/rival.
  'territoryLoyaltyTick.ts',
  // Debts and loans are per-CONTRACT, not per-faction.
  'economyTick.ts',
])

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
      // ripple that reaches every affected faction, information spreading to
      // every witness. Those need BOTH halves: the `roster-exempt:` marker
      // with its reason in the handler, and an entry in
      // ROSTER_EXEMPT_HANDLERS above. See that list for why.
      const declaresExemption = /roster-exempt:/.test(source)
      const isDeclaredExempt = ROSTER_EXEMPT_HANDLERS.has(basename(file))

      if (appliesFilter) continue
      if (declaresExemption && isDeclaredExempt) continue

      missing.push(
        declaresExemption
          ? `${basename(file)} (has the marker, not in ROSTER_EXEMPT_HANDLERS)`
          : basename(file)
      )
    }

    expect(
      missing,
      `These handlers query factions/NPCs without restricting to ctx.roster and without ` +
        `a declared exemption, so they silently simulate a different population than ` +
        `the rest of the tick. An exemption needs the "roster-exempt: <reason>" marker ` +
        `in the handler AND an entry in ROSTER_EXEMPT_HANDLERS in this file.`
    ).toEqual([])
  })

  // #445: the other direction. A list that only ever grows accumulates
  // entries for handlers that have since started filtering properly, and then
  // it is documentation of the past rather than a decision about the present.
  it('has no stale entry in ROSTER_EXEMPT_HANDLERS', () => {
    const sources = new Map(tickHandlerSources().map(({ file, source }) => [basename(file), source]))
    const stale: string[] = []

    for (const name of ROSTER_EXEMPT_HANDLERS) {
      const source = sources.get(name)
      if (source === undefined) {
        stale.push(`${name} (no such tick handler)`)
      } else if (!/roster-exempt:/.test(source)) {
        stale.push(`${name} (listed here, no marker in the handler)`)
      }
    }

    expect(
      stale,
      `ROSTER_EXEMPT_HANDLERS names handlers that no longer claim the exemption. ` +
        `Remove them, so the list stays a statement about what is true now.`
    ).toEqual([])
  })
})
