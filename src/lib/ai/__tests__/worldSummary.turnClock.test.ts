// src/lib/ai/__tests__/worldSummary.turnClock.test.ts
//
// #437: the AI GM prompt is built on the SIMULATION clock.
//
// Every fixture here sets simulationTurn and currentTurnNumber to
// deliberately DIFFERENT values, and to values on opposite sides of each
// other across the two describes. That is the whole design: with the two
// equal — which is what a campaign looks like right after creation, and
// what every existing fixture in this suite happened to encode — an
// assertion passes whichever clock the code reads, so the crossings the v3
// audit found were sitting inside code that was already "covered".
//
// The concrete bug: War.startedTurn is stamped by warTick on the sim clock,
// and the prompt subtracted it from the SCENE counter. Any campaign that
// had ticked more than it had been played told the AI GM a war had been
// running for a negative number of turns.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    worldMeta: { findUnique: vi.fn() },
    character: { findMany: vi.fn() },
    nPC: { findMany: vi.fn() },
    faction: { findMany: vi.fn() },
    location: { findMany: vi.fn() },
    clock: { findMany: vi.fn() },
    war: { findMany: vi.fn() },
    quest: { findMany: vi.fn() },
    scene: { findMany: vi.fn() },
    eventWitness: { findMany: vi.fn() },
    campaign: { findUnique: vi.fn() },
    timelineEvent: { findMany: vi.fn() },
  },
}))

vi.mock('../contextManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../contextManager')>()
  return {
    ...actual,
    buildOptimizedContext: vi.fn(async () => ({
      recentScenes: [], compressedHistory: [], importantMoments: [], campaignSummary: undefined,
    })),
  }
})

import { prisma } from '@/lib/prisma'
import { buildOptimizedWorldSummary, RECENT_WITNESS_WINDOW_TURNS } from '../worldSummary'

const db = prisma as any

/** The two clocks, far apart, with the SCENE counter deliberately ahead. */
function meta(simulationTurn: number, currentTurnNumber: number) {
  return {
    campaignId: 'camp1',
    simulationTurn,
    currentTurnNumber,
    tension: 20,
    phase: null,
    currentInGameDate: 'Day 3',
    totalElapsedGameHours: 72,
    campaign: { calendarConfig: null },
  }
}

function faction(id: string, name: string) {
  return { id, campaignId: 'camp1', name, isDiscovered: true, isActive: true, threatLevel: 3,
    resources: 50, military: 50, stability: 50, influence: 50, goal: null, description: null,
    beliefVector: null, territory: [], leaderCharacterId: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.campaign.findUnique.mockResolvedValue({ id: 'camp1', calendarConfig: null })
  db.character.findMany.mockResolvedValue([
    { id: 'c1', campaignId: 'camp1', name: 'Kess', currentLocation: null, isAlive: true,
      consequences: null, inventory: null, factionStandings: [], debts: [], capabilities: [], knownConcepts: null },
  ])
  db.nPC.findMany.mockResolvedValue([])
  db.faction.findMany.mockResolvedValue([])
  db.location.findMany.mockResolvedValue([])
  db.clock.findMany.mockResolvedValue([])
  db.war.findMany.mockResolvedValue([])
  db.quest.findMany.mockResolvedValue([])
  db.timelineEvent.findMany.mockResolvedValue([])
  db.eventWitness.findMany.mockResolvedValue([])
})

describe('a campaign that has ticked more than it has been played (#437)', () => {
  // Sim 40, scene 10 — the shape that made turns_elapsed negative.
  beforeEach(() => db.worldMeta.findUnique.mockResolvedValue(meta(40, 10)))

  it('never reports a war as having run for a negative number of turns', async () => {
    db.faction.findMany.mockResolvedValue([faction('f1', 'Ashcrown'), faction('f2', 'The Rustwatch')])
    db.war.findMany.mockResolvedValue([{
      id: 'w1', campaignId: 'camp1', name: 'The Border War', status: 'ESCALATING', momentum: 10,
      attackerFactionId: 'f1', defenderFactionId: 'f2', startedTurn: 25, participants: [],
    }])

    const { worldSummary } = await buildOptimizedWorldSummary('camp1', 20, null)

    // 40 - 25 = 15 world turns. Against the scene counter it was 10 - 25 = -15.
    expect((worldSummary as any).wars[0].turns_elapsed).toBe(15)
  })

  it('windows the witness recency query on the sim clock', async () => {
    await buildOptimizedWorldSummary('camp1', 20, null)

    expect(db.eventWitness.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        turnNumber: { gte: 40 - RECENT_WITNESS_WINDOW_TURNS },
      }),
    }))
  })
})

describe('a campaign played hard between two world turns (#437)', () => {
  // The mirror case. Sim 5, scene 60 — here the old code's window was
  // 60 - RECENT_WITNESS_WINDOW_TURNS, far ahead of any real witness row, so
  // every witness silently vanished from the prompt rather than going
  // negative. Same bug, opposite symptom, and only one of the two is
  // visible in the output.
  beforeEach(() => db.worldMeta.findUnique.mockResolvedValue(meta(5, 60)))

  it('does not window witnesses out of the prompt entirely', async () => {
    await buildOptimizedWorldSummary('camp1', 20, null)

    const where = db.eventWitness.findMany.mock.calls[0][0].where
    expect(where.turnNumber.gte).toBe(5 - RECENT_WITNESS_WINDOW_TURNS)
    // The sim clock is at 5, so the window reaches back past the start of
    // the campaign — every real witness row qualifies, which is correct for
    // a world that has barely ticked.
    expect(where.turnNumber.gte).toBeLessThanOrEqual(0)
  })

  it('still measures war duration in world turns', async () => {
    db.faction.findMany.mockResolvedValue([faction('f1', 'Ashcrown'), faction('f2', 'The Rustwatch')])
    db.war.findMany.mockResolvedValue([{
      id: 'w1', campaignId: 'camp1', name: 'The Border War', status: 'ESCALATING', momentum: 0,
      attackerFactionId: 'f1', defenderFactionId: 'f2', startedTurn: 2, participants: [],
    }])

    const { worldSummary } = await buildOptimizedWorldSummary('camp1', 20, null)

    // 3 world turns, not the 58 scene exchanges the old code reported.
    expect((worldSummary as any).wars[0].turns_elapsed).toBe(3)
  })
})
