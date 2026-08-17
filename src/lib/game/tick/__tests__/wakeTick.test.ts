import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    activeWake: { findMany: vi.fn(), create: vi.fn(), createMany: vi.fn(), update: vi.fn() },
    faction: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    nPC: { findMany: vi.fn(), update: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { decideWakeStabilityPenalty, decideWakeDecayStep, tickWake } from '../wakeTick'
import type { TickContext } from '../types'
import { factionTieRows } from './tieFixtures'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: 5, factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any, ...overrides }
}

describe('decideWakeStabilityPenalty (#103)', () => {
  it('penalizes an ordinary member\'s death at the base magnitude', () => {
    expect(decideWakeStabilityPenalty({ sourceType: 'NPC', roughness: 0, wasLeader: false })).toBe(-3)
  })

  it('penalizes a leader\'s death harder than a member\'s, at the same roughness', () => {
    const memberPenalty = decideWakeStabilityPenalty({ sourceType: 'NPC', roughness: 0, wasLeader: false })
    const leaderPenalty = decideWakeStabilityPenalty({ sourceType: 'NPC', roughness: 0, wasLeader: true })
    expect(leaderPenalty).toBeLessThan(memberPenalty)
    expect(leaderPenalty).toBe(-5)
  })

  it('scales with roughness — a rougher transition penalizes harder', () => {
    const smooth = decideWakeStabilityPenalty({ sourceType: 'NPC', roughness: 0, wasLeader: false })
    const rough = decideWakeStabilityPenalty({ sourceType: 'NPC', roughness: 1, wasLeader: false })
    expect(rough).toBeLessThan(smooth)
    expect(rough).toBe(-9)
  })

  it('penalizes a collapse ripple more lightly than losing your own member, at the same (high) roughness', () => {
    // At roughness 0 the two bases (5 vs 6) round to the same -3 — the gap
    // only shows up once roughness actually scales the base apart.
    const collapseRipple = decideWakeStabilityPenalty({ sourceType: 'FACTION', roughness: 1 })
    const memberDeath = decideWakeStabilityPenalty({ sourceType: 'NPC', roughness: 1, wasLeader: false })
    expect(collapseRipple).toBeGreaterThan(memberDeath) // less negative
    expect(collapseRipple).toBe(-8)
  })

  it('scales the collapse ripple with roughness too', () => {
    expect(decideWakeStabilityPenalty({ sourceType: 'FACTION', roughness: 1 })).toBe(-8)
  })

  it('always returns a non-positive penalty regardless of inputs', () => {
    expect(decideWakeStabilityPenalty({ sourceType: 'NPC', roughness: 0, wasLeader: false })).toBeLessThanOrEqual(0)
    expect(decideWakeStabilityPenalty({ sourceType: 'FACTION', roughness: 0 })).toBeLessThanOrEqual(0)
  })
})

describe('decideWakeDecayStep (#103)', () => {
  it('restores an even share each turn, short of the final turn', () => {
    const step = decideWakeDecayStep({ totalStabilityPenalty: -10, currentTicks: 0, maxTicks: 5 })
    expect(step).toEqual({ nextCurrentTicks: 1, restoreAmount: 2, resolved: false })
  })

  it('resolves on the turn currentTicks reaches maxTicks', () => {
    const step = decideWakeDecayStep({ totalStabilityPenalty: -10, currentTicks: 4, maxTicks: 5 })
    expect(step.nextCurrentTicks).toBe(5)
    expect(step.resolved).toBe(true)
  })

  it('restores the rounding remainder on the final turn rather than a fixed share', () => {
    // perTurnRestore = round(7/3) = 2, so 2+2 over the first two turns leaves
    // 3 for the final turn, not another 2 — the whole penalty is restored
    // exactly, with no residual left stranded.
    const turn1 = decideWakeDecayStep({ totalStabilityPenalty: -7, currentTicks: 0, maxTicks: 3 })
    const turn2 = decideWakeDecayStep({ totalStabilityPenalty: -7, currentTicks: 1, maxTicks: 3 })
    const turn3 = decideWakeDecayStep({ totalStabilityPenalty: -7, currentTicks: 2, maxTicks: 3 })
    expect(turn1.restoreAmount + turn2.restoreAmount + turn3.restoreAmount).toBe(7)
    expect(turn3.resolved).toBe(true)
  })

  it('handles a single-turn wake correctly', () => {
    const step = decideWakeDecayStep({ totalStabilityPenalty: -6, currentTicks: 0, maxTicks: 1 })
    expect(step).toEqual({ nextCurrentTicks: 1, restoreAmount: 6, resolved: true })
  })
})

describe('tickWake (DB handler)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // #441: wake creation is createMany + skipDuplicates now (ON CONFLICT
    // DO NOTHING) — a raised P2002 inside the shared tick transaction
    // aborted the whole turn, which the old catch-and-continue could not
    // recover from. Default: one row inserted.
    vi.mocked(prisma.activeWake.createMany).mockResolvedValue({ count: 1 } as any)
  })

  it('does nothing when there are no active wakes, dead NPCs, or collapsed factions', async () => {
    vi.mocked(prisma.activeWake.findMany).mockResolvedValueOnce([]) // decay pass
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([]) // dead npcs
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([]) // collapsed factions

    const result = await tickWake(baseCtx())

    expect(result.changes).toEqual([])
  })

  it('restores partial stability for a mid-decay wake without resolving it', async () => {
    vi.mocked(prisma.activeWake.findMany).mockResolvedValueOnce([
      { id: 'w1', affectedFactionId: 'f1', totalStabilityPenalty: -10, currentTicks: 0, maxTicks: 5 },
    ] as any)
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ stability: 40 } as any)
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([])

    await tickWake(baseCtx())

    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { stability: 42 } })
    expect(prisma.activeWake.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { currentTicks: 1, resolvedAt: null } })
  })

  it('resolves a wake once its decay finishes', async () => {
    vi.mocked(prisma.activeWake.findMany).mockResolvedValueOnce([
      { id: 'w1', affectedFactionId: 'f1', totalStabilityPenalty: -10, currentTicks: 4, maxTicks: 5 },
    ] as any)
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ stability: 48 } as any)
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([])

    await tickWake(baseCtx())

    const updateCall = vi.mocked(prisma.activeWake.update).mock.calls[0][0] as any
    expect(updateCall.data.currentTicks).toBe(5)
    expect(updateCall.data.resolvedAt).toBeInstanceOf(Date)
  })

  it('creates a wake and hits stability for an ordinary member\'s death', async () => {
    vi.mocked(prisma.activeWake.findMany)
      .mockResolvedValueOnce([]) // decay pass
      .mockResolvedValueOnce([]) // already-processed NPC check
    vi.mocked(prisma.nPC.findMany)
      .mockResolvedValueOnce([{ id: 'npc1', name: 'Aldric', factionId: 'f1', factionRole: 'MEMBER' }] as any) // dead npcs
      .mockResolvedValueOnce([]) // colleagues
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f1', name: 'Ashcrown', stability: 50, isActive: true } as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([]) // collapsed factions

    const result = await tickWake(baseCtx())

    // No successionRoughness on ctx for this faction, so it falls back to
    // DEFAULT_ROUGHNESS (0.4): -round(6 * (0.5+0.4) * 1) = -5.
    expect(prisma.activeWake.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ sourceType: 'NPC', sourceEntityId: 'npc1', affectedFactionId: 'f1', totalStabilityPenalty: -5 })],
      skipDuplicates: true,
    })
    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { stability: 45 } })
    expect(result.changes).toHaveLength(1)
    // #310: the discriminator npcDispositionTick.ts/beliefTick.ts now
    // need to tell this genuine NPC-death ripple apart from
    // economyTick.ts's FACTION_DEFAULT cascade, which writes the same
    // (FACTION, field: 'stability', origin: 'wake') shape otherwise.
    expect(result.changes[0]).toMatchObject({ entityType: 'FACTION', entityId: 'f1', field: 'stability', significant: true, importance: 'NORMAL', origin: 'wake', wakeSourceType: 'NPC' })
  })

  it('marks a leader\'s death MAJOR and scales the penalty by #112\'s successionRoughness', async () => {
    vi.mocked(prisma.activeWake.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Regent', factionId: 'f1', factionRole: 'LEADER' }] as any).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f1', name: 'Ashcrown', stability: 50, isActive: true } as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([])

    const result = await tickWake(baseCtx({ successionRoughnessByFactionId: new Map([['f1', 1]]) }))

    expect(prisma.activeWake.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ totalStabilityPenalty: -14 })],
      skipDuplicates: true,
    })
    expect(result.changes[0]).toMatchObject({ importance: 'MAJOR' })
  })

  it('applies a one-time goal-progress setback to other living major NPCs in the same faction', async () => {
    vi.mocked(prisma.activeWake.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(prisma.nPC.findMany)
      .mockResolvedValueOnce([{ id: 'npc1', name: 'Aldric', factionId: 'f1', factionRole: 'MEMBER' }] as any)
      .mockResolvedValueOnce([{ id: 'colleague1', goalProgress: 60 }] as any)
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f1', name: 'Ashcrown', stability: 50, isActive: true } as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([])

    await tickWake(baseCtx())

    expect(prisma.nPC.update).toHaveBeenCalledWith({ where: { id: 'colleague1' }, data: { goalProgress: 45 } })
  })

  it('skips a dead NPC whose faction has itself already collapsed', async () => {
    vi.mocked(prisma.activeWake.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Aldric', factionId: 'f1', factionRole: 'MEMBER' }] as any)
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f1', name: 'Ashcrown', stability: 50, isActive: false } as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([])

    const result = await tickWake(baseCtx())

    expect(prisma.activeWake.createMany).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('skips a dead NPC whose death was already processed', async () => {
    vi.mocked(prisma.activeWake.findMany)
      .mockResolvedValueOnce([]) // decay pass
      .mockResolvedValueOnce([{ sourceEntityId: 'npc1' }] as any) // already processed
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Aldric', factionId: 'f1', factionRole: 'MEMBER' }] as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([])

    const result = await tickWake(baseCtx())

    expect(prisma.faction.findUnique).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('ripples a collapse to a related still-active faction', async () => {
    vi.mocked(prisma.activeWake.findMany)
      .mockResolvedValueOnce([]) // decay pass
      .mockResolvedValueOnce([]) // already-processed factions
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([]) // no dead npcs
    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([
        { id: 'f-collapsed', name: 'The Fallen Court', ...factionTieRows('f-collapsed', { 'f-rival': { type: 'RIVAL', since: 1 } }) },
      ] as any) // collapsed factions
      .mockResolvedValueOnce([{ id: 'f-rival', name: 'Rival Co', stability: 60 }] as any) // related, active

    const result = await tickWake(baseCtx({ collapseRoughnessByFactionId: new Map([['f-collapsed', 0]]) }))

    expect(prisma.activeWake.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ sourceType: 'FACTION', sourceEntityId: 'f-collapsed', affectedFactionId: 'f-rival', totalStabilityPenalty: -3 })],
      skipDuplicates: true,
    })
    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'f-rival' }, data: { stability: 57 } })
    expect(result.changes).toHaveLength(1)
    // #310: same discriminator as the NPC-death ripple above.
    expect(result.changes[0]).toMatchObject({ entityId: 'f-rival', origin: 'wake', significant: true, wakeSourceType: 'FACTION' })
  })

  it('skips a collapse with no related factions at all', async () => {
    vi.mocked(prisma.activeWake.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f-collapsed', name: 'The Fallen Court', ...factionTieRows('f-collapsed', {}) },
    ] as any)

    const result = await tickWake(baseCtx())

    expect(prisma.activeWake.createMany).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('skips a collapse already processed', async () => {
    vi.mocked(prisma.activeWake.findMany)
      .mockResolvedValueOnce([]) // decay pass
      .mockResolvedValueOnce([{ sourceEntityId: 'f-collapsed' }] as any) // already processed
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f-collapsed', name: 'The Fallen Court', ...factionTieRows('f-collapsed', { 'f-rival': { type: 'RIVAL', since: 1 } }) },
    ] as any)

    const result = await tickWake(baseCtx())

    expect(prisma.activeWake.createMany).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('writes nothing in dry-run mode but still reports the changes', async () => {
    vi.mocked(prisma.activeWake.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([{ id: 'npc1', name: 'Aldric', factionId: 'f1', factionRole: 'MEMBER' }] as any)
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f1', name: 'Ashcrown', stability: 50, isActive: true } as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([])

    const result = await tickWake(baseCtx({ dryRun: true }))

    expect(prisma.activeWake.createMany).not.toHaveBeenCalled()
    expect(prisma.faction.update).not.toHaveBeenCalled()
    expect(result.changes).toHaveLength(1)
  })
})
