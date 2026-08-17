// src/lib/game/__tests__/worldTurnReplay.test.ts
//
// #436 and #444, which are the same defect seen from two angles.
//
// #444 first, because it explains why #436 shipped at all: an auditor froze
// the simulation clock (`simulationTurn + 1` → `simulationTurn`) and the
// entire default suite — 4,357 tests — passed. Every tick-handler test
// builds its own TickContext with a literal `turnNumber`, so the turn
// arrives as a parameter, always correct, in all of them. Nothing exercised
// the DERIVATION of that number from WorldMeta, so freezing the derivation
// was invisible.
//
// That is the same shape as two other bugs this codebase shipped in a
// single week: the tutorial seeding test mocked `count: 1` so the seed
// branch never ran, and the digest test passed the discovered-id set in
// directly so the query that builds it was never exercised. Three times,
// one lesson: a test that INJECTS what production DERIVES proves the
// consumer works and says nothing about the producer.
//
// So these assert the producer. They are deliberately about `runWorldTurn`'s
// arithmetic and bookkeeping, not about any handler's behaviour.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const worldMeta = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(async () => ({ count: 1 })),
  update: vi.fn(async () => ({})),
}))
const runWorldTick = vi.hoisted(() => vi.fn(async () => ({
  campaignId: 'camp1', turnNumber: 0, timestamp: new Date(),
  changes: [], historyEntriesCreated: 0, pendingAmbitions: [],
})))
const advanceClocks = vi.hoisted(() => vi.fn(async () => [] as any[]))
const checkAndResolveCompletedClocks = vi.hoisted(() => vi.fn(async () => [] as any[]))

vi.mock('@/lib/prisma', () => ({ prisma: { worldMeta } }))
vi.mock('../worldTick', () => ({ runWorldTick }))
vi.mock('../tick/clockTick', () => ({ advanceClocks }))
vi.mock('../stateUpdater', () => ({ checkAndResolveCompletedClocks }))
vi.mock('../worldTurnOffscreenEvents', () => ({
  generateOffscreenEvents: vi.fn(async () => {}),
  applyNpcGoalFallbacks: vi.fn(async () => {}),
}))
vi.mock('../tick/ambitionResolution', () => ({ resolveCompletedAmbitions: vi.fn(async () => {}) }))
vi.mock('../tick/clockResolutionEffects', () => ({ resolveGenericClockEffects: vi.fn(async () => {}) }))
vi.mock('@/lib/notifications/world-digest', () => ({ sendWorldDigest: vi.fn(async () => 0) }))
vi.mock('@/lib/ai/memoryConsolidation', () => ({ consolidateOldMemories: vi.fn(async () => null) }))
vi.mock('@/lib/ai/chronicleNarration', () => ({
  buildChronicleNarrationInput: vi.fn(async () => null),
  generateChronicleNarration: vi.fn(async () => null),
}))

import { runWorldTurn } from '../worldTurn'
import { TURN_PHASE } from '../tick/simulationClock'

/** A WorldMeta row with the columns runWorldTurn actually reads. */
function meta(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: 'camp1',
    simulationTurn: 40,
    totalElapsedGameHours: 0,
    turnInFlight: null,
    turnPhaseCompleted: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  worldMeta.updateMany.mockResolvedValue({ count: 1 })
})

describe('the turn number runWorldTurn derives (#444)', () => {
  it('runs the turn AFTER the one the simulation has reached', async () => {
    // The whole assertion is `+ 1`. Freezing it is the defect that has now
    // shipped three times and passed every other test in the suite.
    worldMeta.findUnique.mockResolvedValue(meta({ simulationTurn: 40 }))

    await runWorldTurn('camp1')

    expect(runWorldTick).toHaveBeenCalledWith('camp1', 41)
    expect(advanceClocks).toHaveBeenCalledWith('camp1', 41)
  })

  it('advances with the clock rather than pinning to a constant', async () => {
    worldMeta.findUnique.mockResolvedValue(meta({ simulationTurn: 40 }))
    await runWorldTurn('camp1')
    worldMeta.findUnique.mockResolvedValue(meta({ simulationTurn: 41 }))
    await runWorldTurn('camp1')

    expect((runWorldTick.mock.calls as unknown as any[][]).map(c => c[1])).toEqual([41, 42])
  })

  it('starts at turn 1 on a brand-new campaign', async () => {
    worldMeta.findUnique.mockResolvedValue(meta({ simulationTurn: 0 }))
    await runWorldTurn('camp1')
    expect(runWorldTick).toHaveBeenCalledWith('camp1', 1)
  })
})

describe('replay safety across a failed turn (#436)', () => {
  it('reuses the in-flight turn number instead of deriving a new one', async () => {
    // The bug: simulationTurn commits with the tick, so a failure in any
    // later phase left it advanced and the retry ran at N+2. Every dedupeKey
    // embeds the turn, so at a fresh number nothing could ever collide — the
    // retry wrote a second full set of events and doubled the drift derived
    // from counting them.
    worldMeta.findUnique.mockResolvedValue(
      meta({ simulationTurn: 41, turnInFlight: 41, turnPhaseCompleted: TURN_PHASE.TICK })
    )

    await runWorldTurn('camp1')

    // 41, not 42. That single number is what makes the keys collide.
    expect(advanceClocks).toHaveBeenCalledWith('camp1', 41)
  })

  it('does not re-run the tick whose transaction already committed', async () => {
    // A stable turn number alone would be worse than the bug: re-running the
    // tick re-applies every faction stat delta.
    worldMeta.findUnique.mockResolvedValue(
      meta({ simulationTurn: 41, turnInFlight: 41, turnPhaseCompleted: TURN_PHASE.TICK })
    )

    await runWorldTurn('camp1')

    expect(runWorldTick).not.toHaveBeenCalled()
  })

  it('skips every phase at or below the watermark, and runs the rest', async () => {
    // Clock advancement increments; resolution resolves. Neither is
    // idempotent, so a resume past them must not repeat them.
    worldMeta.findUnique.mockResolvedValue(
      meta({ simulationTurn: 41, turnInFlight: 41, turnPhaseCompleted: TURN_PHASE.CLOCKS_ADVANCED })
    )

    await runWorldTurn('camp1')

    expect(runWorldTick).not.toHaveBeenCalled()
    expect(advanceClocks).not.toHaveBeenCalled()
    expect(checkAndResolveCompletedClocks).toHaveBeenCalledWith('camp1', 41, expect.any(Number))
  })

  it('clears the marker when the turn completes, so the next turn advances', async () => {
    worldMeta.findUnique.mockResolvedValue(meta({ simulationTurn: 40 }))

    await runWorldTurn('camp1')

    expect(worldMeta.updateMany).toHaveBeenCalledWith({
      where: { campaignId: 'camp1', turnInFlight: 41 },
      data: { turnInFlight: null, turnPhaseCompleted: TURN_PHASE.NOTHING },
    })
  })

  it('treats a missing marker as a fresh turn, never as a resume', async () => {
    // The two failure directions are not symmetric. Reading an absent value
    // as in-flight would SKIP THE TICK and silently stop the world, which is
    // strictly worse than re-deriving a turn number. Rows written before the
    // column existed, and any partial select, must land on "fresh".
    worldMeta.findUnique.mockResolvedValue({ simulationTurn: 40, totalElapsedGameHours: 0 })

    await runWorldTurn('camp1')

    expect(runWorldTick).toHaveBeenCalledWith('camp1', 41)
  })
})
