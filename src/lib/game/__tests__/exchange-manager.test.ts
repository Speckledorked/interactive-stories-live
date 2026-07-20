// src/lib/game/__tests__/exchange-manager.test.ts
// Regression coverage for the exchangeNumber/currentExchange divergence
// bug: a scene's first-ever exchange is 0, and `|| 1` used to coerce that
// real 0 into 1, permanently orphaning the first action ever submitted.
// Also covers reconcileOrphanedActions, the self-heal for scenes already
// corrupted by that bug before the fix shipped, and the lost-update race
// in recordAction that let two players acting in the same instant silently
// clobber each other's playersActed entry.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    scene: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
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
      id: 'scene1', currentExchange: 0, exchangeState: null, updatedAt: new Date('2026-01-01T00:00:00Z'),
    })
    db.playerAction.update.mockResolvedValue({})
    db.scene.updateMany.mockResolvedValue({ count: 1 })

    const state = await new ExchangeManager('camp1', 'scene1').recordAction('char1', 'action1')

    expect(state.exchangeNumber).toBe(0)
    expect(db.playerAction.update).toHaveBeenCalledWith({
      where: { id: 'action1' },
      data: { exchangeNumber: 0 },
    })
  })

  it('retries against the fresh row instead of clobbering a concurrent update', async () => {
    const staleUpdatedAt = new Date('2026-01-01T00:00:00Z')
    const freshUpdatedAt = new Date('2026-01-01T00:00:01Z')

    // First read: as if another player's recordAction call already landed
    // in between our initial read and our write attempt.
    db.scene.findUnique
      .mockResolvedValueOnce({
        id: 'scene1', currentExchange: 0, updatedAt: staleUpdatedAt,
        exchangeState: null,
      })
      .mockResolvedValueOnce({
        id: 'scene1', currentExchange: 0, updatedAt: freshUpdatedAt,
        exchangeState: { playersActed: ['char2'], exchangeNumber: 0, isComplete: false, complexity: 'simple', actionsThisExchange: 1, timestamp: new Date() },
      })
    db.playerAction.update.mockResolvedValue({})
    // First updateMany call (guarded on the stale updatedAt) matches
    // nothing — someone else already moved the row forward.
    db.scene.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })

    const state = await new ExchangeManager('camp1', 'scene1').recordAction('char1', 'action1')

    // Both characters end up recorded — char2 (from the concurrent write
    // we retried against) and char1 (this call) — nobody's contribution
    // was lost.
    expect(state.playersActed).toEqual(['char2', 'char1'])
    expect(db.scene.updateMany).toHaveBeenCalledTimes(2)
    expect(db.scene.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'scene1', updatedAt: staleUpdatedAt },
      data: expect.anything(),
    })
    expect(db.scene.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'scene1', updatedAt: freshUpdatedAt },
      data: expect.anything(),
    })
  })
})

describe('canResolveExchange', () => {
  it('is false when only one of two participants has acted', async () => {
    db.scene.findUnique.mockResolvedValue({
      currentExchange: 0,
      participants: { characterIds: ['char1', 'char2'] },
      exchangeState: { playersActed: ['char2'], exchangeNumber: 0, isComplete: false, complexity: 'simple', actionsThisExchange: 1, timestamp: new Date() },
    })

    // This used to return true here — `actionsThisExchange > 0` alone
    // was enough to short-circuit the "everyone acted" check, letting a
    // scene auto-resolve off a single player's action while a second,
    // already-pending action from another player sat unaddressed.
    const canResolve = await new ExchangeManager('camp1', 'scene1').canResolveExchange()

    expect(canResolve).toBe(false)
  })

  it('is true once every participant has acted', async () => {
    db.scene.findUnique.mockResolvedValue({
      currentExchange: 0,
      participants: { characterIds: ['char1', 'char2'] },
      exchangeState: { playersActed: ['char1', 'char2'], exchangeNumber: 0, isComplete: false, complexity: 'simple', actionsThisExchange: 2, timestamp: new Date() },
    })

    const canResolve = await new ExchangeManager('camp1', 'scene1').canResolveExchange()

    expect(canResolve).toBe(true)
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
      currentExchange: 3,
      playerActions: [],
    })

    const swept = await new ExchangeManager('camp1', 'scene1').reconcileOrphanedActions()

    expect(swept).toEqual([])
    expect(db.playerAction.updateMany).not.toHaveBeenCalled()
  })

  it('sweeps pending actions orphaned from a prior resolved exchange', async () => {
    db.scene.findUnique.mockResolvedValue({
      sceneResolutionText: 'The scene resolved...',
      currentExchange: 3,
      playerActions: [
        { id: 'orphan1', characterId: 'char1', exchangeNumber: 2 },
        { id: 'current1', characterId: 'char2', exchangeNumber: 3 },
      ],
    })
    db.playerAction.updateMany.mockResolvedValue({ count: 1 })

    const swept = await new ExchangeManager('camp1', 'scene1').reconcileOrphanedActions()

    expect(swept).toEqual(['orphan1'])
    expect(db.playerAction.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['orphan1'] } },
      data: { status: 'resolved' },
    })
  })

  it('leaves a genuinely in-flight action alone even when exchangeState.playersActed has not caught up yet', async () => {
    // Regression: a brand-new pending action's exchangeNumber is stamped
    // atomically at creation (scene/route.ts), but exchangeState.playersActed
    // is written moments later by a separate call (recordAction). A
    // reconcile sweep that lands in that gap must not treat "not yet in
    // playersActed" as orphaned — this action's exchangeNumber already
    // matches the scene's current exchange, so it's current regardless of
    // what exchangeState says.
    db.scene.findUnique.mockResolvedValue({
      sceneResolutionText: 'The scene resolved...',
      currentExchange: 3,
      playerActions: [{ id: 'current1', characterId: 'char2', exchangeNumber: 3 }],
      exchangeState: { playersActed: [], exchangeNumber: 3, isComplete: false, complexity: 'simple', actionsThisExchange: 0, timestamp: new Date() },
    })

    const swept = await new ExchangeManager('camp1', 'scene1').reconcileOrphanedActions()

    expect(swept).toEqual([])
    expect(db.playerAction.updateMany).not.toHaveBeenCalled()
  })
})
