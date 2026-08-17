// src/lib/game/__tests__/turnClockConvention.test.ts
//
// #437: every write to a sim-clock turn column is fed from a SimTurn.
//
// Branded types do most of this work — a function that declares SimTurn
// cannot be handed the scene counter, and aliasing does not launder it. But
// branding has one hole, and it is exactly where these bugs live: Prisma's
// generated `data:` types accept a plain `number`, so
//
//     await prisma.timelineEvent.create({ data: { turnNumber: someNumber } })
//
// compiles no matter which clock `someNumber` came from. That is the shape
// of five of the seven crossings the v3 audit found, and of the eighth
// (campaignMilestone's crisis WorldEvent) that only turned up while fixing
// the seven.
//
// So: the declared sim-clock columns are listed here, and the identifier
// feeding each write has to be one that is SimTurn-typed at its
// declaration. Adding a new name is a one-line change plus the branding
// that justifies it — and a new write with an unbranded name fails loudly
// instead of quietly stamping the wrong unit.
//
// Same family as fogOfWar, guardedWriteConvention, capOrdering.convention,
// promptQueryBounds and locationPairing.convention.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const SRC = join(process.cwd(), 'src')

/**
 * Models whose turn columns are on the SIMULATION clock. This is the list
 * turnClock.ts's "every persisted turn column is sim-clock" rule refers to;
 * CampaignLog is deliberately absent (it is the per-scene story log).
 */
const SIM_CLOCK_MODELS: Record<string, string[]> = {
  worldEvent: ['turnNumber'],
  eventWitness: ['turnNumber'],
  timelineEvent: ['turnNumber'],
  campaignMemory: ['turnNumber', 'lastRetrievedTurn'],
  war: ['startedTurn', 'resolvedTurn'],
  warParticipant: ['joinedTurn'],
  populationFlightEvent: ['turnNumber'],
}

/**
 * `file: identifier` pairs that are SimTurn at their point of declaration.
 *
 * Scoped to the FILE on purpose. The first draft of this guard allowed a
 * bare name list, and dumping what it matched immediately showed why that
 * is unsound: `currentTurn` is the simulation turn in worldTurn.ts and the
 * SCENE counter in sceneResolver.ts, and the global list happily waved
 * through a real crossing in the second. A name is not a unit — that is the
 * whole premise of this issue, and the guard has to hold itself to it.
 *
 * Every entry is a reviewed claim: the named identifier is declared SimTurn
 * (or assigned from one) in that file, so the compiler enforces what this
 * list asserts.
 */
const SIM_TURN_SOURCES = new Set([
  // stateUpdater's lazily-resolved sim turn, and the batch value taken from it
  'src/lib/game/stateUpdater.ts: simulationTurn',
  'src/lib/game/stateUpdater.ts: eventTurn',
  // resolved from currentSimulationTurn() at the top of the function
  'src/lib/game/campaignMilestone.ts: simulationTurn',
  // applyTimelineEventChanges' own SimTurn parameter
  'src/lib/game/worldUpdaters/timelineEvents.ts: simulationTurn',
  // runWorldTurn's derived world turn, threaded through these phases
  'src/lib/game/tick/ambitionResolution.ts: currentTurn',
  'src/lib/game/worldTurnOffscreenEvents.ts: currentTurn',
  'src/lib/notifications/world-digest.ts: currentTurn',
  // TickContext.turnNumber — SimTurn (tick/types.ts)
  'src/lib/game/tick/informationTick.ts: ctx.turnNumber',
  'src/lib/game/tick/migrationTick.ts: ctx.turnNumber',
  'src/lib/game/tick/warTick.ts: ctx.turnNumber',
  // runWorldTick's own SimTurn parameter
  'src/lib/game/tick/worldEventLog.ts: turnNumber',
  // resolved from currentSimulationTurn() immediately above the write —
  // `currentTurn` in this file is the SCENE counter, which is what made
  // this a crossing in the first place
  'src/lib/game/sceneResolver.ts: beatTurn',
])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' || entry === 'node_modules' ? [] : sourceFiles(full)
    }
    return (entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.d.ts') ? [full] : []
  })
}

/** End index of the argument list opened by the `(` at `open`. */
function matchingParen(source: string, open: number): number {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++
    else if (source[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return source.length
}

interface Write {
  file: string
  model: string
  column: string
  expression: string
}

/** Prisma writes to a sim-clock model that assign one of its turn columns. */
function simClockWrites(file: string, source: string): Write[] {
  const found: Write[] = []
  const call = /\b(?:prisma|tx|db|ctx\.db)\.(\w+)\.(create|createMany|createManyAndReturn|update|updateMany|upsert)\(/g
  let m: RegExpExecArray | null
  while ((m = call.exec(source))) {
    const columns = SIM_CLOCK_MODELS[m[1]]
    if (!columns) continue
    const body = source.slice(m.index, matchingParen(source, call.lastIndex - 1) + 1)
    for (const column of columns) {
      const assign = new RegExp(`(?<![\\w."'])${column}\\s*:\\s*([^,\\n}]+)`, 'g')
      let a: RegExpExecArray | null
      while ((a = assign.exec(body))) {
        const expression = a[1].trim()
        // `column: true` is a select projection, not a write.
        if (expression === 'true' || expression === 'false') continue
        found.push({ file: file.replace(process.cwd() + '/', ''), model: m[1], column, expression })
      }
    }
  }
  return found
}

describe('sim-clock turn columns are written from SimTurn values (#437)', () => {
  const files = sourceFiles(SRC).map((file) => ({ file, source: readFileSync(file, 'utf-8') }))
  const writes = files.flatMap(({ file, source }) => simClockWrites(file, source))

  it('finds the writes it is meant to be guarding', () => {
    // A guard that matches nothing passes forever. If the Prisma call shape
    // changes, this is what says so instead of the suite going quietly green.
    const models = new Set(writes.map((w) => w.model))
    expect(writes.length).toBeGreaterThanOrEqual(15)
    expect(models).toContain('worldEvent')
    expect(models).toContain('eventWitness')
    expect(models).toContain('timelineEvent')
  })

  it('has no write fed from an identifier that is not a declared SimTurn', () => {
    const offenders = writes
      // Wrapped at the write site, with the provenance stated there.
      .filter((w) => !w.expression.startsWith('simTurn('))
      .filter((w) => !SIM_TURN_SOURCES.has(`${w.file}: ${w.expression.replace(/!$/, '')}`))
      .map((w) => `${w.file}: ${w.model}.${w.column} = ${w.expression}`)

    expect(
      offenders,
      'A sim-clock turn column written from something other than a declared ' +
      'SimTurn. Prisma\'s data: types accept a plain number, so the compiler ' +
      'cannot see this — which is how the scene counter reached EventWitness, ' +
      'TimelineEvent, CampaignMemory and WorldEvent. Brand the value at its ' +
      'source (turnClock.ts) and add `file: name` to SIM_TURN_SOURCES here, ' +
      'or wrap it in simTurn() at the write with a comment saying where it ' +
      'came from.\n  ' + offenders.join('\n  ')
    ).toEqual([])
  })

  it('nothing writes a sim-clock column from the scene counter, under any alias', () => {
    // The specific mistake, named. currentTurnNumber is the scene clock's
    // one canonical name; a write fed from it directly is unambiguous.
    const offenders = writes
      .filter((w) => /currentTurnNumber/.test(w.expression))
      .map((w) => `${w.file}: ${w.model}.${w.column} = ${w.expression}`)
    expect(offenders).toEqual([])
  })
})
