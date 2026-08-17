// src/lib/ai/__tests__/worldSummary.eventWitness.test.ts
//
// #101 (PR 3/3): both world-summary builders now attach each prompt
// character's own EventWitness knowledge. This proves the query is
// scoped to just this scene's promptCharacters (a non-participant's
// witness rows must never leak into a split-party scene's prompt) and
// that the mapped output actually carries witnessed_events/told_events.

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
      recentScenes: [],
      compressedHistory: [],
      importantMoments: [],
      campaignSummary: undefined,
    })),
  }
})

import { prisma } from '@/lib/prisma'
import { buildOptimizedWorldSummary, buildWorldSummaryForAI } from '../worldSummary'

const db = prisma as any

function baseWorldMeta() {
  return {
    campaignId: 'camp1',
    currentTurnNumber: 50,
    // #437: the witness window is on the SIMULATION clock. Deliberately
    // different from currentTurnNumber — see worldSummary.turnClock.test.ts
    // for the assertions that depend on the two being distinguishable.
    simulationTurn: 30,
    tension: 20,
    phase: null,
    currentInGameDate: 'Day 3',
    totalElapsedGameHours: 72,
    campaign: { calendarConfig: null },
  }
}

function character(id: string, name: string) {
  return {
    id, campaignId: 'camp1', name, currentLocation: null, isAlive: true,
    consequences: null, inventory: null, factionStandings: [], debts: [], capabilities: [], knownConcepts: null,
  }
}

function npc(id: string, name: string) {
  return {
    id, campaignId: 'camp1', name, description: null, goals: null, relationship: null,
    importance: 5, factionId: null, factionRole: null, socialTies: null, isDiscovered: true,
    currentLocation: null, locationId: null, gmNotes: null, threat: null, impulses: [], moves: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.worldMeta.findUnique.mockResolvedValue(baseWorldMeta())
  db.campaign.findUnique.mockResolvedValue({ id: 'camp1', calendarConfig: null })
  db.nPC.findMany.mockResolvedValue([])
  db.faction.findMany.mockResolvedValue([])
  db.location.findMany.mockResolvedValue([])
  db.clock.findMany.mockResolvedValue([])
  db.war.findMany.mockResolvedValue([])
  db.quest.findMany.mockResolvedValue([])
  db.timelineEvent.findMany.mockResolvedValue([])
  db.eventWitness.findMany.mockResolvedValue([])
})

describe('buildOptimizedWorldSummary — event witness scoping (#101)', () => {
  it('scopes the eventWitness query to only the prompt characters\' ids', async () => {
    db.character.findMany.mockResolvedValue([character('c1', 'Kess'), character('c2', 'Wren')])

    // Split-party: only c1 is in this scene.
    await buildOptimizedWorldSummary('camp1', 20, ['c1'])

    expect(db.eventWitness.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        campaignId: 'camp1',
        characterId: { in: ['c1'] },
        turnNumber: { gte: expect.any(Number) },
      }),
    }))
  })

  it('never queries eventWitness when there are no prompt characters', async () => {
    db.character.findMany.mockResolvedValue([])

    await buildOptimizedWorldSummary('camp1', 20, null)

    expect(db.eventWitness.findMany).not.toHaveBeenCalled()
  })

  it('attaches witnessed_events and told_events to the right character', async () => {
    db.character.findMany.mockResolvedValue([character('c1', 'Kess')])
    db.eventWitness.findMany.mockResolvedValue([
      { characterId: 'c1', grade: 'WITNESSED', turnNumber: 49, worldEvent: { reason: 'The bridge collapsed' } },
      { characterId: 'c1', grade: 'TOLD', turnNumber: 48, worldEvent: { reason: 'The baron fled' } },
    ])

    const { worldSummary } = await buildOptimizedWorldSummary('camp1', 20, null)

    const kess: any = worldSummary.characters.find((c: any) => c.id === 'c1')
    expect(kess.witnessed_events).toEqual(['The bridge collapsed'])
    expect(kess.told_events).toEqual(['The baron fled'])
  })
})

describe('buildWorldSummaryForAI — event witness scoping (#101)', () => {
  it('scopes the eventWitness query to only the prompt characters\' ids', async () => {
    db.character.findMany.mockResolvedValue([character('c1', 'Kess'), character('c2', 'Wren')])

    await buildWorldSummaryForAI('camp1', ['c2'])

    expect(db.eventWitness.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ characterId: { in: ['c2'] } }),
    }))
  })

  it('attaches witnessed_events and told_events to the right character', async () => {
    db.character.findMany.mockResolvedValue([character('c1', 'Kess')])
    db.eventWitness.findMany.mockResolvedValue([
      { characterId: 'c1', grade: 'WITNESSED', turnNumber: 49, worldEvent: { reason: 'Saw the fire' } },
    ])

    const { worldSummary } = await buildWorldSummaryForAI('camp1', null)

    const kess: any = worldSummary.characters.find((c: any) => c.id === 'c1')
    expect(kess.witnessed_events).toEqual(['Saw the fire'])
    expect(kess.told_events).toEqual([])
  })
})

describe('buildOptimizedWorldSummary — NPC event witness scoping (#101 misinformation)', () => {
  it('scopes the eventWitness query to only the selected NPCs\' ids, using npcId not characterId', async () => {
    db.character.findMany.mockResolvedValue([])
    db.nPC.findMany.mockResolvedValue([npc('n1', 'Old Harl')])

    await buildOptimizedWorldSummary('camp1', 20, null)

    expect(db.eventWitness.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        campaignId: 'camp1',
        npcId: { in: ['n1'] },
        turnNumber: { gte: expect.any(Number) },
      }),
    }))
  })

  it('attaches told_events (and never witnessed_events) to the right NPC, with a distortion suffix baked in', async () => {
    db.character.findMany.mockResolvedValue([])
    db.nPC.findMany.mockResolvedValue([npc('n1', 'Old Harl')])
    db.eventWitness.findMany.mockResolvedValue([
      { npcId: 'n1', grade: 'TOLD', turnNumber: 48, distorted: true, distortionFlavor: 'EXAGGERATED', worldEvent: { reason: 'The baron fled' } },
    ])

    const { worldSummary } = await buildOptimizedWorldSummary('camp1', 20, null)

    const harl: any = worldSummary.npcs.find((n: any) => n.id === 'n1')
    expect(harl.told_events).toEqual(['The baron fled (this account sounds exaggerated)'])
    expect(harl.witnessed_events).toBeUndefined()
  })

  it('never queries eventWitness for npcId when there are no discovered NPCs', async () => {
    db.character.findMany.mockResolvedValue([])
    db.nPC.findMany.mockResolvedValue([])

    await buildOptimizedWorldSummary('camp1', 20, null)

    expect(db.eventWitness.findMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ npcId: expect.anything() }),
    }))
  })
})
