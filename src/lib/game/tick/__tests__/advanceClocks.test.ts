// src/lib/game/tick/__tests__/advanceClocks.test.ts
// #229 — advanceClocks used a bare, un-transacted per-clock write loop: a
// mid-loop failure could leave some clocks advanced and others not, with
// the rest of this turn's world state already durably committed via
// runWorldTick's own transaction (advanceClocks runs after that, outside
// it — see worldTurn.ts). These tests pin the fix: every clock write for
// one call now goes through a single prisma.$transaction batch, so a
// partial-failure window no longer exists for clock advancement itself.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  clockFindMany: vi.fn(),
  clockUpdate: vi.fn(),
  factionFindMany: vi.fn(),
  worldMetaFindUnique: vi.fn(),
  worldMetaUpdate: vi.fn(),
  warCount: vi.fn(),
  characterFindMany: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clock: { findMany: mocks.clockFindMany, update: mocks.clockUpdate, fields: { maxTicks: 'maxTicks' } },
    faction: { findMany: mocks.factionFindMany },
    worldMeta: { findUnique: mocks.worldMetaFindUnique, update: mocks.worldMetaUpdate },
    war: { count: mocks.warCount },
    character: { findMany: mocks.characterFindMany },
    $transaction: mocks.transaction,
  },
}))

import { advanceClocks } from '../clockTick'

function baseClock(overrides: Partial<{
  id: string
  name: string
  category: string | null
  currentTicks: number
  maxTicks: number
  sourceFactionId: string | null
  relatedFactionId: string | null
  participantNpcIds: string[]
}> = {}) {
  return {
    id: 'clock-1',
    name: 'Test Clock',
    category: 'urgent', // always advances 1 tick — deterministic, no faction/roll dependency
    currentTicks: 0,
    maxTicks: 5,
    sourceFactionId: null,
    relatedFactionId: null,
    participantNpcIds: [],
    ...overrides,
  }
}

describe('advanceClocks (#229)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.factionFindMany.mockResolvedValue([])
    mocks.worldMetaFindUnique.mockResolvedValue({ currentTurnNumber: 1, totalElapsedGameHours: 0, campaign: { calendarConfig: null } })
    mocks.worldMetaUpdate.mockResolvedValue({})
    mocks.warCount.mockResolvedValue(0)
    mocks.characterFindMany.mockResolvedValue([])
    // Array-of-promises form: prisma.$transaction([...]) — resolve each
    // "promise" (here, whatever clockUpdate itself returns) in order.
    mocks.transaction.mockImplementation(async (ops: any[]) => Promise.all(ops))
    mocks.clockUpdate.mockImplementation(async (args: any) => ({ id: args.where.id }))
  })

  it('batches every advancing clock\'s write into a single $transaction call, not one write per clock', async () => {
    mocks.clockFindMany.mockResolvedValueOnce([
      baseClock({ id: 'clock-a', name: 'Clock A' }),
      baseClock({ id: 'clock-b', name: 'Clock B' }),
    ])

    const result = await advanceClocks('camp1')

    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.clockUpdate).toHaveBeenCalledTimes(2)
    expect(mocks.clockUpdate).toHaveBeenCalledWith({ where: { id: 'clock-a' }, data: { currentTicks: 1 } })
    expect(mocks.clockUpdate).toHaveBeenCalledWith({ where: { id: 'clock-b' }, data: { currentTicks: 1 } })
    // $transaction was called with the actual clock.update call results
    // batched together — a real transaction batch, not a bare loop of
    // individually-awaited writes.
    const batchedOps = mocks.transaction.mock.calls[0][0]
    expect(batchedOps).toHaveLength(2)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 'clock-a', oldTicks: 0, newTicks: 1 })
    expect(result[1]).toMatchObject({ id: 'clock-b', oldTicks: 0, newTicks: 1 })
  })

  it('never calls $transaction when no clock actually advances this turn', async () => {
    mocks.clockFindMany.mockResolvedValueOnce([
      // Tracked ambition of an inactive faction — deterministically 0
      // advance, no roll involved (see explainClockAdvancement).
      baseClock({ id: 'clock-stalled', category: null, sourceFactionId: 'f-dead' }),
    ])
    mocks.factionFindMany.mockResolvedValueOnce([{ id: 'f-dead', resources: 80, military: 80, stability: 0, isActive: false }])

    const result = await advanceClocks('camp1')

    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.clockUpdate).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('excludes a non-advancing clock from the batch while still advancing the others', async () => {
    mocks.clockFindMany.mockResolvedValueOnce([
      baseClock({ id: 'clock-advances' }),
      baseClock({ id: 'clock-stalled', category: null, sourceFactionId: 'f-dead' }),
    ])
    mocks.factionFindMany.mockResolvedValueOnce([{ id: 'f-dead', resources: 80, military: 80, stability: 0, isActive: false }])

    const result = await advanceClocks('camp1')

    expect(mocks.clockUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.clockUpdate).toHaveBeenCalledWith({ where: { id: 'clock-advances' }, data: { currentTicks: 1 } })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('clock-advances')
  })

  it('caps a clock\'s new tick count at its own maxTicks', async () => {
    mocks.clockFindMany.mockResolvedValueOnce([
      baseClock({ id: 'clock-near-done', currentTicks: 4, maxTicks: 5, category: 'urgent' }),
    ])

    const result = await advanceClocks('camp1')

    expect(mocks.clockUpdate).toHaveBeenCalledWith({ where: { id: 'clock-near-done' }, data: { currentTicks: 5 } })
    expect(result[0]).toMatchObject({ oldTicks: 4, newTicks: 5 })
  })
})
