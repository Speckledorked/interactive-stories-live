import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    worldEvent: {
      createManyAndReturn: vi.fn().mockResolvedValue([]),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import { persistWorldEvents } from '../worldEventLog'
import type { WorldChange } from '../types'

function makeChange(overrides: Partial<WorldChange> = {}): WorldChange {
  return {
    entityType: 'FACTION',
    entityId: 'faction-1',
    entityName: 'The Rustwatch',
    campaignId: 'campaign-1',
    field: 'resources',
    previousValue: 50,
    newValue: 47,
    reason: 'test reason',
    significant: true,
    importance: 'NORMAL',
    ...overrides,
  }
}

describe('persistWorldEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing for an empty batch', async () => {
    const result = await persistWorldEvents('campaign-1', 5, [])
    expect(result).toEqual({ count: 0, events: [] })
    expect(prisma.worldEvent.createManyAndReturn).not.toHaveBeenCalled()
  })

  it('maps tick-origin changes to actorType SYSTEM', async () => {
    vi.mocked(prisma.worldEvent.createManyAndReturn).mockResolvedValueOnce([{ id: 'e1', significant: true }] as any)
    await persistWorldEvents('campaign-1', 5, [makeChange({ origin: undefined })])
    const call = vi.mocked(prisma.worldEvent.createManyAndReturn).mock.calls[0][0] as any
    expect(call.data[0].actorType).toBe('SYSTEM')
    expect(call.data[0].origin).toBe('tick')
  })

  it('maps consequence-origin changes to actorType PLAYER', async () => {
    vi.mocked(prisma.worldEvent.createManyAndReturn).mockResolvedValueOnce([{ id: 'e1', significant: true }] as any)
    await persistWorldEvents('campaign-1', 5, [makeChange({ origin: 'consequence' })])
    const call = vi.mocked(prisma.worldEvent.createManyAndReturn).mock.calls[0][0] as any
    expect(call.data[0].actorType).toBe('PLAYER')
  })

  it('builds a filterable type key from entityType + field', async () => {
    vi.mocked(prisma.worldEvent.createManyAndReturn).mockResolvedValueOnce([{ id: 'e1', significant: true }] as any)
    await persistWorldEvents('campaign-1', 5, [makeChange({ entityType: 'NPC', field: 'currentPlan' })])
    const call = vi.mocked(prisma.worldEvent.createManyAndReturn).mock.calls[0][0] as any
    expect(call.data[0].type).toBe('npc.currentPlan')
  })

  it('stringifies numeric previous/new values', async () => {
    vi.mocked(prisma.worldEvent.createManyAndReturn).mockResolvedValueOnce([{ id: 'e1', significant: true }] as any)
    await persistWorldEvents('campaign-1', 5, [makeChange({ previousValue: 50, newValue: 47 })])
    const call = vi.mocked(prisma.worldEvent.createManyAndReturn).mock.calls[0][0] as any
    expect(call.data[0].previousValue).toBe('50')
    expect(call.data[0].newValue).toBe('47')
  })

  it('persists every change, not just significant ones', async () => {
    vi.mocked(prisma.worldEvent.createManyAndReturn).mockResolvedValueOnce([
      { id: 'e1', significant: true },
      { id: 'e2', significant: false },
    ] as any)
    await persistWorldEvents('campaign-1', 5, [
      makeChange({ significant: true }),
      makeChange({ significant: false }),
    ])
    const call = vi.mocked(prisma.worldEvent.createManyAndReturn).mock.calls[0][0] as any
    expect(call.data).toHaveLength(2)
  })

  // #101: the WITNESSED write path (stateUpdater.ts) needs real ids and
  // each row's significant flag back — createMany alone never returns
  // rows, which is why this switched to createManyAndReturn.
  it('returns the created events\' ids and significant flags', async () => {
    vi.mocked(prisma.worldEvent.createManyAndReturn).mockResolvedValueOnce([
      { id: 'e1', significant: true },
      { id: 'e2', significant: false },
    ] as any)
    const result = await persistWorldEvents('campaign-1', 5, [
      makeChange({ significant: true }),
      makeChange({ significant: false }),
    ])
    expect(result).toEqual({
      count: 2,
      events: [
        { id: 'e1', significant: true },
        { id: 'e2', significant: false },
      ],
    })
  })

  it('returns an empty result and swallows errors instead of throwing', async () => {
    vi.mocked(prisma.worldEvent.createManyAndReturn).mockRejectedValueOnce(new Error('db down'))
    const result = await persistWorldEvents('campaign-1', 5, [makeChange()])
    expect(result).toEqual({ count: 0, events: [] })
  })
})
