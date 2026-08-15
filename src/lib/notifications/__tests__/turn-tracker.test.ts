// src/lib/notifications/__tests__/turn-tracker.test.ts
// This service had zero test coverage before #319/#320. Both issues were
// found in an adversarial audit of the "Turn order/timeout tracking"
// Scorecard row: removePlayerFromTurn/addPlayerToTurn were fully built
// but called from nowhere (#319), and an expired deadline with
// autoAdvanceTurn: false (the only mode anything sets) produced total
// silence — no reminder, no auto-advance, no host notification (#320).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  trackerFindFirstMock, trackerFindManyMock, trackerUpdateMock,
  membershipFindManyMock, createNotificationMock, campaignFindUniqueMock,
} = vi.hoisted(() => ({
  trackerFindFirstMock: vi.fn(),
  trackerFindManyMock: vi.fn(),
  trackerUpdateMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  createNotificationMock: vi.fn(),
  campaignFindUniqueMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    turnTracker: {
      findFirst: trackerFindFirstMock,
      findMany: trackerFindManyMock,
      update: trackerUpdateMock,
    },
    campaignMembership: { findMany: membershipFindManyMock },
    campaign: { findUnique: campaignFindUniqueMock },
  },
}))

vi.mock('../notification-service', () => ({
  NotificationService: { createNotification: (...args: unknown[]) => createNotificationMock(...args) },
}))

import { TurnTracker } from '../turn-tracker'

beforeEach(() => {
  vi.clearAllMocks()
  trackerUpdateMock.mockResolvedValue({})
  campaignFindUniqueMock.mockResolvedValue({ title: 'The Deep Wood' })
})

function tracker(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    campaignId: 'c1',
    sceneId: 's1',
    currentTurn: 0,
    turnOrder: [
      { userId: 'u1', name: 'Alice' },
      { userId: 'u2', name: 'Bob' },
      { userId: 'u3', name: 'Carol' },
    ],
    turnTimeoutMinutes: 60,
    remindersSent: [],
    lastReminderSent: null,
    turnDeadline: new Date(Date.now() + 60 * 60 * 1000),
    campaign: { title: 'The Deep Wood' },
    ...overrides,
  }
}

describe('removePlayerFromTurn (#319)', () => {
  it('removes the player and shifts a later current-turn index down', async () => {
    trackerFindFirstMock.mockResolvedValue(tracker({ currentTurn: 2 })) // Carol's turn
    await TurnTracker.removePlayerFromTurn('c1', 's1', 'u1') // Alice leaves, before current

    const call = trackerUpdateMock.mock.calls[0][0]
    expect(call.data.turnOrder).toEqual([{ userId: 'u2', name: 'Bob' }, { userId: 'u3', name: 'Carol' }])
    expect(call.data.currentTurn).toBe(1)
  })

  it('advances to the next player (wrapping) when the current player is the one removed', async () => {
    trackerFindFirstMock.mockResolvedValue(tracker({ currentTurn: 2 })) // Carol's turn
    await TurnTracker.removePlayerFromTurn('c1', 's1', 'u3')

    const call = trackerUpdateMock.mock.calls[0][0]
    expect(call.data.turnOrder).toEqual([{ userId: 'u1', name: 'Alice' }, { userId: 'u2', name: 'Bob' }])
    expect(call.data.currentTurn).toBe(0) // wraps to 2 % 2
  })

  it('does not divide by zero when the last remaining player is removed', async () => {
    trackerFindFirstMock.mockResolvedValue(
      tracker({ currentTurn: 0, turnOrder: [{ userId: 'u1', name: 'Alice' }] })
    )
    await TurnTracker.removePlayerFromTurn('c1', 's1', 'u1')

    const call = trackerUpdateMock.mock.calls[0][0]
    expect(call.data.turnOrder).toEqual([])
    expect(call.data.currentTurn).toBe(0)
  })

  it('rejects a player who is not in the turn order', async () => {
    trackerFindFirstMock.mockResolvedValue(tracker())
    await expect(TurnTracker.removePlayerFromTurn('c1', 's1', 'ghost')).rejects.toThrow('Player not found in turn order')
    expect(trackerUpdateMock).not.toHaveBeenCalled()
  })
})

describe('notifyOverdueTurns (#320)', () => {
  it('notifies every campaign admin once for an overdue, non-auto-advancing turn', async () => {
    trackerFindManyMock.mockResolvedValue([tracker({ currentTurn: 0 })])
    membershipFindManyMock.mockResolvedValue([{ userId: 'admin1' }, { userId: 'admin2' }])

    const count = await TurnTracker.notifyOverdueTurns()

    expect(count).toBe(1)
    expect(createNotificationMock).toHaveBeenCalledTimes(2)
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin1', campaignId: 'c1', priority: 'HIGH' })
    )
    expect(trackerUpdateMock).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { overdueNotifiedAt: expect.any(Date) },
    })
  })

  it('only queries trackers not yet notified for their current deadline', async () => {
    trackerFindManyMock.mockResolvedValue([])
    await TurnTracker.notifyOverdueTurns()

    const call = trackerFindManyMock.mock.calls[0][0]
    expect(call.where).toMatchObject({ autoAdvanceTurn: false, overdueNotifiedAt: null })
  })

  it('never throws when a single tracker fails, and still processes the rest', async () => {
    trackerFindManyMock.mockResolvedValue([tracker({ id: 't1', campaignId: 'c1' }), tracker({ id: 't2', campaignId: 'c2' })])
    membershipFindManyMock
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([{ userId: 'admin1' }])

    const count = await TurnTracker.notifyOverdueTurns()
    expect(count).toBe(1)
  })
})

describe('advanceTurn clears overdue/reminder state (#320)', () => {
  it('resets overdueNotifiedAt alongside remindersSent when the turn advances', async () => {
    trackerFindFirstMock.mockResolvedValue(tracker({ currentTurn: 0 }))
    await TurnTracker.advanceTurn('c1', 's1', 'u1')

    const call = trackerUpdateMock.mock.calls[0][0]
    expect(call.data.overdueNotifiedAt).toBeNull()
    expect(call.data.remindersSent).toEqual([])
  })
})
