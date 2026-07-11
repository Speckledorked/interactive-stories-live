import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    faction: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    nPC: { updateMany: vi.fn(), findMany: vi.fn() },
    location: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    warParticipant: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { tickFactionRelationships } from '../relationshipTick'
import { tickFactions } from '../factionTick'
import { tickFactionAmbitions } from '../ambitionTick'
import type { TickContext } from '../types'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: 5, factionCap: 10, npcCap: 20, dryRun: false, ...overrides }
}

function makeFaction(id: string, overrides: Record<string, any> = {}) {
  return {
    id,
    name: id,
    campaignId: 'campaign-1',
    resources: 50,
    stability: 50,
    military: 50,
    goal: 'CONSOLIDATE',
    archetype: 'GENERIC',
    relationships: {},
    leaderCharacterId: null,
    isActive: true,
    ...overrides,
  }
}

describe('tickFactionRelationships (audit fixes)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accumulates same-tick changes against multiple partners instead of clobbering', async () => {
    // Three EXPAND factions: A becomes rival with BOTH B and C in one tick.
    // The old per-pair write-from-stale-fetch pattern would lose A's B entry
    // when the A-C pair wrote.
    const a = makeFaction('a', { goal: 'EXPAND' })
    const b = makeFaction('b', { goal: 'EXPAND' })
    const c = makeFaction('c', { goal: 'EXPAND' })

    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([a, b, c] as any) // capped active list
      .mockResolvedValueOnce([
        { id: 'a', name: 'a', isActive: true },
        { id: 'b', name: 'b', isActive: true },
        { id: 'c', name: 'c', isActive: true },
      ] as any) // full roster

    await tickFactionRelationships(baseCtx())

    const aWrite = vi.mocked(prisma.faction.update).mock.calls.find((call) => (call[0] as any).where.id === 'a')
    expect(aWrite).toBeTruthy()
    const aRelationships = (aWrite![0] as any).data.relationships
    // BOTH rivalries must survive into the single final write.
    expect(aRelationships.b).toMatchObject({ type: 'RIVAL' })
    expect(aRelationships.c).toMatchObject({ type: 'RIVAL' })
  })

  it('expires a relationship whose other side has collapsed', async () => {
    const survivor = makeFaction('survivor', {
      goal: 'DEFEND',
      relationships: { fallen: { type: 'RIVAL', since: 2 } },
    })

    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([survivor] as any) // capped active list
      .mockResolvedValueOnce([
        { id: 'survivor', name: 'survivor', isActive: true },
        { id: 'fallen', name: 'The Fallen Order', isActive: false },
      ] as any) // full roster including the defunct rival

    const result = await tickFactionRelationships(baseCtx())

    const write = vi.mocked(prisma.faction.update).mock.calls.find((call) => (call[0] as any).where.id === 'survivor')
    expect(write).toBeTruthy()
    expect((write![0] as any).data.relationships.fallen).toBeUndefined()
    expect(result.changes.some((c) => c.reason.includes('The Fallen Order'))).toBe(true)
  })

  it('writes nothing on the expiry path when dryRun is true', async () => {
    const survivor = makeFaction('survivor', {
      relationships: { fallen: { type: 'ALLY', since: 2 } },
    })
    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([survivor] as any)
      .mockResolvedValueOnce([{ id: 'survivor', name: 'survivor', isActive: true }] as any)

    const result = await tickFactionRelationships(baseCtx({ dryRun: true }))

    expect(prisma.faction.update).not.toHaveBeenCalled()
    expect(result.changes.length).toBeGreaterThan(0)
  })
})

describe('tickFactions stale-rival guard (audit fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reassesses goal ignoring a rival that no longer exists as an active faction', async () => {
    // Strong faction with a stale RIVAL entry pointing at a collapsed
    // faction: with the rival counted it would pick DESTABILIZE_RIVAL;
    // ignoring it, EXPAND (military HIGH + resources HIGH).
    const strong = makeFaction('strong', {
      goal: 'CONSOLIDATE',
      resources: 80,
      stability: 80,
      military: 80,
      relationships: { ghost: { type: 'RIVAL', since: 1 } },
    })

    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([strong] as any) // capped main list
      .mockResolvedValueOnce([{ id: 'strong' }] as any) // active ids — 'ghost' absent

    await tickFactions(baseCtx())

    const write = vi.mocked(prisma.faction.update).mock.calls.find((call) => (call[0] as any).where.id === 'strong')
    expect(write).toBeTruthy()
    expect((write![0] as any).data.goal).toBe('EXPAND')
  })
})

describe('tickFactionAmbitions war exclusion (audit fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips a faction that is fighting in an active war', async () => {
    const warring = makeFaction('warring', {
      goal: 'ENRICH',
      resources: 90, // rich enough that it would otherwise commit
      spawnedClocks: [],
    })
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([warring] as any)
    vi.mocked(prisma.warParticipant.findMany).mockResolvedValueOnce([{ factionId: 'warring' }] as any)

    const result = await tickFactionAmbitions(baseCtx())

    expect(result.pendingAmbitions ?? []).toHaveLength(0)
    expect(prisma.faction.update).not.toHaveBeenCalled()
  })

  it('still lets a faction not at war commit to an ambition', async () => {
    const peaceful = makeFaction('peaceful', {
      goal: 'ENRICH',
      resources: 90,
      spawnedClocks: [],
    })
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([peaceful] as any)
    vi.mocked(prisma.warParticipant.findMany).mockResolvedValueOnce([] as any)

    const result = await tickFactionAmbitions(baseCtx())

    expect((result.pendingAmbitions ?? []).length).toBe(1)
  })
})
