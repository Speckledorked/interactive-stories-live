// src/lib/game/__tests__/worldTurnPacingRestore.test.ts
//
// Integrity Engine Phase 3: runWorldTick's own writes now roll back
// cleanly on failure (one transaction across every handler), but
// runWorldTurnIfDue's atomic claim already spends the banked
// hoursSinceWorldTurn BEFORE runWorldTurn ever runs — so a failure
// anywhere in runWorldTurn (the tick itself, or anything after it) used to
// silently eat those hours with no retry. This covers the restore path
// that fixes that: on a thrown error, exactly what this attempt consumed
// is added back (not overwritten), so a concurrent resolution's own banked
// hours aren't clobbered and the next heartbeat retries the turn.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const worldMeta = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(async () => ({})),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { worldMeta } }))
vi.mock('../worldTick', () => ({ runWorldTick: vi.fn(async () => { throw new Error('tick exploded') }) }))

import { runWorldTurnIfDue } from '../worldTurn'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runWorldTurnIfDue — restoring banked hours on failure', () => {
  it('adds back exactly what this attempt consumed when runWorldTurn throws', async () => {
    // 30 banked, 24h threshold (default) -> remainingHours = min(30-24, 24) = 6,
    // so this claim consumed 24 of the 30 banked hours.
    worldMeta.findUnique.mockResolvedValue({ hoursSinceWorldTurn: 30, worldTurnHours: null })
    worldMeta.updateMany.mockResolvedValue({ count: 1 })

    await expect(runWorldTurnIfDue('camp1')).rejects.toThrow('tick exploded')

    expect(worldMeta.updateMany).toHaveBeenCalledWith({
      where: { campaignId: 'camp1', hoursSinceWorldTurn: { gte: 24 } },
      data: { hoursSinceWorldTurn: 6 },
    })
    expect(worldMeta.update).toHaveBeenCalledWith({
      where: { campaignId: 'camp1' },
      data: { hoursSinceWorldTurn: { increment: 24 } },
    })
  })

  it('does not restore anything when the claim never landed (a concurrent resolution already ran it)', async () => {
    worldMeta.findUnique.mockResolvedValue({ hoursSinceWorldTurn: 30, worldTurnHours: null })
    worldMeta.updateMany.mockResolvedValue({ count: 0 })

    const result = await runWorldTurnIfDue('camp1')

    expect(result).toEqual({ ran: false })
    expect(worldMeta.update).not.toHaveBeenCalled()
  })

  it('does not restore anything when the turn is not due at all', async () => {
    worldMeta.findUnique.mockResolvedValue({ hoursSinceWorldTurn: 5, worldTurnHours: null })

    const result = await runWorldTurnIfDue('camp1')

    expect(result).toEqual({ ran: false })
    expect(worldMeta.updateMany).not.toHaveBeenCalled()
    expect(worldMeta.update).not.toHaveBeenCalled()
  })
})
