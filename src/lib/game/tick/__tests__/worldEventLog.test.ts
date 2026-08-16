import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    worldEvent: {
      createManyAndReturn: vi.fn().mockResolvedValue([]),
      // #377: read-back for rows a replay skipped.
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import { persistWorldEvents, worldEventDedupeKeys } from '../worldEventLog'
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

  // #310: wakeSourceType is the discriminator npcDispositionTick.ts/
  // beliefTick.ts now read to tell a genuine death/collapse wake apart
  // from economyTick.ts's FACTION_DEFAULT cascade — must actually reach
  // the persisted row, not just live on the in-memory WorldChange.
  it('passes wakeSourceType through for a wake-origin change', async () => {
    vi.mocked(prisma.worldEvent.createManyAndReturn).mockResolvedValueOnce([{ id: 'e1', significant: true }] as any)
    await persistWorldEvents('campaign-1', 5, [makeChange({ origin: 'wake', wakeSourceType: 'FACTION_DEFAULT' })])
    const call = vi.mocked(prisma.worldEvent.createManyAndReturn).mock.calls[0][0] as any
    expect(call.data[0].wakeSourceType).toBe('FACTION_DEFAULT')
  })

  it('defaults wakeSourceType to null when absent', async () => {
    vi.mocked(prisma.worldEvent.createManyAndReturn).mockResolvedValueOnce([{ id: 'e1', significant: true }] as any)
    await persistWorldEvents('campaign-1', 5, [makeChange({ origin: 'tick' })])
    const call = vi.mocked(prisma.worldEvent.createManyAndReturn).mock.calls[0][0] as any
    expect(call.data[0].wakeSourceType).toBeNull()
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

// ---------------------------------------------------------------------------
// #377: replay identity
// ---------------------------------------------------------------------------
//
// A world turn spans ~14 commit boundaries. A failure partway through
// re-runs the WHOLE turn at the same turn number, and before this the
// retry wrote ~40 duplicate rows — which are not inert, because
// beliefTick/npcDispositionTick derive drift by COUNTING prior-turn rows.
// A retry silently doubled the drift it fed back into the simulation.

describe('worldEventDedupeKeys (#377)', () => {
  it('gives the same change list the same keys on a replay', () => {
    const changes = [makeChange(), makeChange({ entityId: 'faction-2', field: 'stability' })]

    expect(worldEventDedupeKeys(5, changes)).toEqual(worldEventDedupeKeys(5, changes))
  })

  it('distinguishes two genuinely different writes to the same field in one turn', () => {
    // Real case: seasonTick and economyTick both nudge faction.resources in
    // the same turn. Collapsing those into one row would silently drop a
    // real event, so the ordinal keeps them apart.
    const [a, b] = worldEventDedupeKeys(5, [
      makeChange({ previousValue: 50, newValue: 47 }),
      makeChange({ previousValue: 50, newValue: 47 }),
    ])

    expect(a).not.toBe(b)
  })

  it('separates the same change in different turns', () => {
    const [turn5] = worldEventDedupeKeys(5, [makeChange()])
    const [turn6] = worldEventDedupeKeys(6, [makeChange()])

    expect(turn5).not.toBe(turn6)
  })

  it('separates changes that differ only in their before/after values', () => {
    const [down] = worldEventDedupeKeys(5, [makeChange({ previousValue: 50, newValue: 47 })])
    const [up] = worldEventDedupeKeys(5, [makeChange({ previousValue: 47, newValue: 50 })])

    expect(down).not.toBe(up)
  })
})

describe('persistWorldEvents — replay safety (#377)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes a dedupeKey per row and asks the database to skip duplicates', async () => {
    vi.mocked(prisma.worldEvent.createManyAndReturn).mockResolvedValueOnce([{ id: 'e1', significant: true }] as any)

    const changes = [makeChange()]
    await persistWorldEvents('campaign-1', 5, changes)

    const call = vi.mocked(prisma.worldEvent.createManyAndReturn).mock.calls[0][0] as any
    expect(call.skipDuplicates).toBe(true)
    expect(call.data[0].dedupeKey).toBe(worldEventDedupeKeys(5, changes)[0])
  })

  it('still returns the events for rows a replay skipped', async () => {
    // The first attempt may well have died BETWEEN writing the events and
    // writing their EventWitness rows — which is exactly the partial state
    // the replay exists to finish. Callers need the ids either way.
    vi.mocked(prisma.worldEvent.createManyAndReturn).mockResolvedValueOnce([] as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValueOnce([{ id: 'already-there', significant: true }] as any)

    const result = await persistWorldEvents('campaign-1', 5, [makeChange()])

    expect(result.events).toEqual([{ id: 'already-there', significant: true }])
    // count reports what this attempt actually inserted, which is nothing.
    expect(result.count).toBe(0)
  })

  it('does not read back when every row was inserted', async () => {
    vi.mocked(prisma.worldEvent.createManyAndReturn).mockResolvedValueOnce([{ id: 'e1', significant: true }] as any)

    await persistWorldEvents('campaign-1', 5, [makeChange()])

    expect(prisma.worldEvent.findMany).not.toHaveBeenCalled()
  })
})
