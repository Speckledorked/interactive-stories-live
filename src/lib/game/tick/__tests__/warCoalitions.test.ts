import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    war: { findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    faction: { update: vi.fn(), findMany: vi.fn() },
    location: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    warParticipant: { create: vi.fn(), createMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { tickWars } from '../warTick'
import type { TickContext } from '../types'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: 5, factionCap: 10, npcCap: 20, dryRun: false, ...overrides }
}

function makeFaction(id: string, overrides: Record<string, any> = {}) {
  return {
    id,
    name: id,
    resources: 50,
    stability: 50,
    military: 50,
    isActive: true,
    relationships: {},
    ...overrides,
  }
}

function makeParticipant(warId: string, factionId: string, side: 'ATTACKER' | 'DEFENDER', faction: any) {
  return { id: `${warId}-${factionId}`, warId, factionId, side, joinedTurn: 1, faction }
}

describe('tickWars coalitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // No new wars declared unless a test explicitly sets these up.
    vi.mocked(prisma.faction.findMany).mockResolvedValue([])
    vi.mocked(prisma.location.findMany).mockResolvedValue([])
  })

  it('aggregates military across every living participant on a side for momentum', async () => {
    const attackerA = makeFaction('att-a', { military: 40 })
    const attackerB = makeFaction('att-b', { military: 40 }) // coalition partner
    const defender = makeFaction('def-a', { military: 30 })

    const war = {
      id: 'war-1',
      campaignId: 'campaign-1',
      name: 'Test War',
      attackerFactionId: 'att-a',
      defenderFactionId: 'def-a',
      contestedLocationId: null,
      momentum: 0,
      startedTurn: 1,
      attacker: attackerA,
      defender,
      participants: [
        makeParticipant('war-1', 'att-a', 'ATTACKER', attackerA),
        makeParticipant('war-1', 'att-b', 'ATTACKER', attackerB),
        makeParticipant('war-1', 'def-a', 'DEFENDER', defender),
      ],
    }
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([war] as any)

    await tickWars(baseCtx({ turnNumber: 2 }))

    // Attacker side total = 80, defender side total = 30 — a much bigger
    // edge than either single attacker faction (40) vs defender (30) alone
    // would produce, proving the aggregate (not just the primary) drove it.
    const updateCall = vi.mocked(prisma.war.update).mock.calls.find((c) => (c[0] as any).where.id === 'war-1')
    expect(updateCall).toBeTruthy()
    const newMomentum = (updateCall![0] as any).data.momentum
    expect(newMomentum).toBeGreaterThan(0) // attacker side is stronger in aggregate
  })

  it('applies attrition to every living participant on both sides, not just the primary two', async () => {
    const attackerA = makeFaction('att-a', { military: 40, resources: 50 })
    const attackerB = makeFaction('att-b', { military: 40, resources: 50 })
    const defender = makeFaction('def-a', { military: 40, resources: 50 })

    const war = {
      id: 'war-1',
      campaignId: 'campaign-1',
      name: 'Test War',
      attackerFactionId: 'att-a',
      defenderFactionId: 'def-a',
      contestedLocationId: null,
      momentum: 0,
      startedTurn: 1,
      attacker: attackerA,
      defender,
      participants: [
        makeParticipant('war-1', 'att-a', 'ATTACKER', attackerA),
        makeParticipant('war-1', 'att-b', 'ATTACKER', attackerB),
        makeParticipant('war-1', 'def-a', 'DEFENDER', defender),
      ],
    }
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([war] as any)

    await tickWars(baseCtx({ turnNumber: 2 }))

    // 3 living participants -> 3 attrition writes, not 2.
    const attritionUpdates = vi.mocked(prisma.faction.update).mock.calls.filter((c) =>
      ['att-a', 'att-b', 'def-a'].includes((c[0] as any).where.id)
    )
    expect(attritionUpdates).toHaveLength(3)
  })

  it('writes nothing when dryRun is true but still reports changes', async () => {
    const attackerA = makeFaction('att-a', { military: 90 })
    const defender = makeFaction('def-a', { military: 10 })

    const war = {
      id: 'war-1',
      campaignId: 'campaign-1',
      name: 'Test War',
      attackerFactionId: 'att-a',
      defenderFactionId: 'def-a',
      contestedLocationId: null,
      momentum: 55, // close to decisive, so this tick should resolve
      startedTurn: 1,
      attacker: attackerA,
      defender,
      participants: [
        makeParticipant('war-1', 'att-a', 'ATTACKER', attackerA),
        makeParticipant('war-1', 'def-a', 'DEFENDER', defender),
      ],
    }
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([war] as any)

    const result = await tickWars(baseCtx({ turnNumber: 3, dryRun: true }))

    expect(prisma.war.update).not.toHaveBeenCalled()
    expect(prisma.faction.update).not.toHaveBeenCalled()
    expect(prisma.location.update).not.toHaveBeenCalled()
    expect(prisma.warParticipant.create).not.toHaveBeenCalled()
    expect(result.changes.length).toBeGreaterThan(0)
  })

  it('ends the war immediately as a stalemate when an entire side has collapsed', async () => {
    const attackerA = makeFaction('att-a', { military: 90, isActive: false }) // collapsed
    const defender = makeFaction('def-a', { military: 50 })

    const war = {
      id: 'war-1',
      campaignId: 'campaign-1',
      name: 'Test War',
      attackerFactionId: 'att-a',
      defenderFactionId: 'def-a',
      contestedLocationId: 'loc-1',
      momentum: 0,
      startedTurn: 1,
      attacker: attackerA,
      defender,
      participants: [
        makeParticipant('war-1', 'att-a', 'ATTACKER', attackerA),
        makeParticipant('war-1', 'def-a', 'DEFENDER', defender),
      ],
    }
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([war] as any)

    const result = await tickWars(baseCtx({ turnNumber: 2 }))

    expect(prisma.war.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'RESOLVED', outcome: 'stalemate' }) })
    )
    expect(result.changes.some((c) => c.field === 'warEnded')).toBe(true)
    // No attrition/momentum math should have run for an already-decided war.
    expect(prisma.faction.update).not.toHaveBeenCalled()
  })

  it('does NOT end the war when a coalition partner collapses but the primary side still has a living member', async () => {
    const attackerA = makeFaction('att-a', { military: 60, isActive: true })
    const attackerB = makeFaction('att-b', { military: 60, isActive: false }) // this partner collapsed
    const defender = makeFaction('def-a', { military: 50 })

    const war = {
      id: 'war-1',
      campaignId: 'campaign-1',
      name: 'Test War',
      attackerFactionId: 'att-a',
      defenderFactionId: 'def-a',
      contestedLocationId: null,
      momentum: 0,
      startedTurn: 1,
      attacker: attackerA,
      defender,
      participants: [
        makeParticipant('war-1', 'att-a', 'ATTACKER', attackerA),
        makeParticipant('war-1', 'att-b', 'ATTACKER', attackerB),
        makeParticipant('war-1', 'def-a', 'DEFENDER', defender),
      ],
    }
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([war] as any)

    await tickWars(baseCtx({ turnNumber: 2 }))

    // The war continues — only the living attacker-side faction (att-a)
    // pays attrition, the collapsed partner does not.
    const attritionUpdates = vi.mocked(prisma.faction.update).mock.calls.filter((c) => (c[0] as any).where.id === 'att-a')
    expect(attritionUpdates.length).toBeGreaterThan(0)
    const collapsedUpdates = vi.mocked(prisma.faction.update).mock.calls.filter((c) => (c[0] as any).where.id === 'att-b')
    expect(collapsedUpdates).toHaveLength(0)
    // The war itself was not force-ended.
    const endedCall = vi.mocked(prisma.war.update).mock.calls.find(
      (c) => (c[0] as any).data.status === 'RESOLVED' && (c[0] as any).data.outcome === 'stalemate'
    )
    expect(endedCall).toBeFalsy()
  })

  it('gives the contested location only to the primary attacker, not to allies, on a win', async () => {
    const attackerA = makeFaction('att-a', { military: 95 })
    const attackerB = makeFaction('att-b', { military: 95 }) // ally, should NOT get the prize
    const defender = makeFaction('def-a', { military: 5 })

    const war = {
      id: 'war-1',
      campaignId: 'campaign-1',
      name: 'Test War',
      attackerFactionId: 'att-a',
      defenderFactionId: 'def-a',
      contestedLocationId: 'loc-1',
      momentum: 50, // + this tick's swing should push it decisive
      startedTurn: 1,
      attacker: attackerA,
      defender,
      participants: [
        makeParticipant('war-1', 'att-a', 'ATTACKER', attackerA),
        makeParticipant('war-1', 'att-b', 'ATTACKER', attackerB),
        makeParticipant('war-1', 'def-a', 'DEFENDER', defender),
      ],
    }
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([war] as any)
    vi.mocked(prisma.location.findUnique).mockResolvedValueOnce({ id: 'loc-1', name: 'The Keep' } as any)

    const result = await tickWars(baseCtx({ turnNumber: 2 }))

    // Aggregate attacker military (95+95=190) vs defender (5) is such a
    // lopsided edge that momentum clamps to the max +20 swing regardless of
    // this tick's deterministic variance, so starting at 50 this resolves
    // decisively in the attacker's favor (>= 60) — not a stalemate.
    expect(result.changes.some((c) => c.field === 'warResolved' && c.newValue === 'attacker')).toBe(true)
    const locationUpdateCall = vi.mocked(prisma.location.update).mock.calls.find((c) => (c[0] as any).where.id === 'loc-1')
    expect(locationUpdateCall).toBeTruthy()
    expect((locationUpdateCall![0] as any).data.ownerFactionId).toBe('att-a')
  })

  it('pulls in an eligible ally as a new WarParticipant', async () => {
    const attackerA = makeFaction('att-a', { military: 50, relationships: { 'ally-1': { type: 'ALLY', since: 1 } } })
    const defender = makeFaction('def-a', { military: 50 })
    const ally = makeFaction('ally-1', { military: 80 }) // strong enough to join

    const war = {
      id: 'war-1',
      campaignId: 'campaign-1',
      name: 'Test War',
      attackerFactionId: 'att-a',
      defenderFactionId: 'def-a',
      contestedLocationId: null,
      momentum: 5, // far from decisive, war continues -> joining pass runs
      startedTurn: 1,
      attacker: attackerA,
      defender,
      participants: [
        makeParticipant('war-1', 'att-a', 'ATTACKER', attackerA),
        makeParticipant('war-1', 'def-a', 'DEFENDER', defender),
      ],
    }
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([war] as any)
    vi.mocked(prisma.faction.findMany).mockImplementation(((args: any) => {
      if (args?.where?.id?.in) return Promise.resolve([ally])
      return Promise.resolve([]) // the "declare new wars" candidate list — irrelevant here
    }) as any)

    const result = await tickWars(baseCtx({ turnNumber: 2 }))

    expect(prisma.warParticipant.create).toHaveBeenCalledWith({
      data: { warId: 'war-1', factionId: 'ally-1', side: 'ATTACKER', joinedTurn: 2 },
    })
    expect(result.changes.some((c) => c.field === 'warJoined' && c.entityId === 'ally-1')).toBe(true)
  })

  it('does not pull in an ally that is already committed to another war', async () => {
    const attackerA = makeFaction('att-a', { military: 50, relationships: { 'busy-ally': { type: 'ALLY', since: 1 } } })
    const defenderA = makeFaction('def-a', { military: 50 })
    const busyAlly = makeFaction('busy-ally', { military: 90 })
    const otherOpponent = makeFaction('other-opp', { military: 50 })

    const warOne = {
      id: 'war-1',
      campaignId: 'campaign-1',
      name: 'War One',
      attackerFactionId: 'att-a',
      defenderFactionId: 'def-a',
      contestedLocationId: null,
      momentum: 5,
      startedTurn: 1,
      attacker: attackerA,
      defender: defenderA,
      participants: [
        makeParticipant('war-1', 'att-a', 'ATTACKER', attackerA),
        makeParticipant('war-1', 'def-a', 'DEFENDER', defenderA),
      ],
    }
    // busy-ally is already fighting in a second, unrelated war.
    const warTwo = {
      id: 'war-2',
      campaignId: 'campaign-1',
      name: 'War Two',
      attackerFactionId: 'busy-ally',
      defenderFactionId: 'other-opp',
      contestedLocationId: null,
      momentum: 5,
      startedTurn: 1,
      attacker: busyAlly,
      defender: otherOpponent,
      participants: [
        makeParticipant('war-2', 'busy-ally', 'ATTACKER', busyAlly),
        makeParticipant('war-2', 'other-opp', 'DEFENDER', otherOpponent),
      ],
    }
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([warOne, warTwo] as any)

    await tickWars(baseCtx({ turnNumber: 2 }))

    expect(prisma.warParticipant.create).not.toHaveBeenCalled()
  })

  it('creates WarParticipant rows for both sides when a brand-new war is declared', async () => {
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([]) // no active wars

    const attacker = makeFaction('att-a', { military: 80, relationships: { 'def-a': { type: 'RIVAL', since: 1 } } })
    const defender = makeFaction('def-a', { military: 80, relationships: { 'att-a': { type: 'RIVAL', since: 1 } } })
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([attacker, defender] as any)
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc-1', name: 'The Keep', ownerFactionId: 'def-a', isContested: true },
    ] as any)
    vi.mocked(prisma.war.create).mockResolvedValueOnce({ id: 'new-war-1' } as any)

    await tickWars(baseCtx({ turnNumber: 2 }))

    expect(prisma.warParticipant.createMany).toHaveBeenCalledWith({
      data: [
        { warId: 'new-war-1', factionId: 'att-a', side: 'ATTACKER', joinedTurn: 2 },
        { warId: 'new-war-1', factionId: 'def-a', side: 'DEFENDER', joinedTurn: 2 },
      ],
    })
  })
})
