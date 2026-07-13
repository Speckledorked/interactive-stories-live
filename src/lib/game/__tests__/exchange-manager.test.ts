// src/lib/game/__tests__/exchange-manager.test.ts
// Regression coverage for the exchangeNumber/currentExchange divergence
// bug: a scene's first-ever exchange is 0, and `|| 1` used to coerce that
// real 0 into 1, permanently orphaning the first action ever submitted.
// Also covers reconcileOrphanedActions, the self-heal for scenes already
// corrupted by that bug before the fix shipped.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    scene: { findUnique: vi.fn(), update: vi.fn() },
    playerAction: { update: vi.fn(), updateMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { ExchangeManager } from '../exchange-manager'

const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
})

describe('recordAction', () => {
  it('preserves a real exchange 0 instead of coercing it to 1', async () => {
    db.scene.findUnique.mockResolvedValue({
      id: 'scene1', currentExchange: 0, exchangeState: null,
    })
    db.playerAction.update.mockResolvedValue({})
    db.scene.update.mockResolvedValue({})

    const state = await new ExchangeManager('camp1', 'scene1').recordAction('char1', 'action1')

    expect(state.exchangeNumber).toBe(0)
    expect(db.playerAction.update).toHaveBeenCalledWith({
      where: { id: 'action1' },
      data: { exchangeNumber: 0 },
    })
  })
})

describe('reconcileOrphanedActions', () => {
  it('does nothing for a scene that has never resolved', async () => {
    db.scene.findUnique.mockResolvedValue({
      sceneResolutionText: null,
      playerActions: [{ id: 'a1', characterId: 'char1' }],
      exchangeState: null,
    })

    const swept = await new ExchangeManager('camp1', 'scene1').reconcileOrphanedActions()

    expect(swept).toEqual([])
    expect(db.playerAction.updateMany).not.toHaveBeenCalled()
  })

  it('does nothing when there are no pending actions', async () => {
    db.scene.findUnique.mockResolvedValue({
      sceneResolutionText: 'The scene resolved...',
      playerActions: [],
      exchangeState: { playersActed: [] },
    })

    const swept = await new ExchangeManager('camp1', 'scene1').reconcileOrphanedActions()

    expect(swept).toEqual([])
    expect(db.playerAction.updateMany).not.toHaveBeenCalled()
  })

  it('sweeps pending actions orphaned from a prior resolved exchange', async () => {
    db.scene.findUnique.mockResolvedValue({
      sceneResolutionText: 'The scene resolved...',
      playerActions: [
        { id: 'orphan1', characterId: 'char1' },
        { id: 'current1', characterId: 'char2' },
      ],
      exchangeState: { playersActed: ['char2'] },
    })
    db.playerAction.updateMany.mockResolvedValue({ count: 1 })

    const swept = await new ExchangeManager('camp1', 'scene1').reconcileOrphanedActions()

    expect(swept).toEqual(['orphan1'])
    expect(db.playerAction.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['orphan1'] } },
      data: { status: 'resolved' },
    })
  })

  it('leaves a genuinely in-flight action alone when its owner is in playersActed', async () => {
    db.scene.findUnique.mockResolvedValue({
      sceneResolutionText: 'The scene resolved...',
      playerActions: [{ id: 'current1', characterId: 'char2' }],
      exchangeState: { playersActed: ['char2'] },
    })

    const swept = await new ExchangeManager('camp1', 'scene1').reconcileOrphanedActions()

    expect(swept).toEqual([])
    expect(db.playerAction.updateMany).not.toHaveBeenCalled()
  })
})
