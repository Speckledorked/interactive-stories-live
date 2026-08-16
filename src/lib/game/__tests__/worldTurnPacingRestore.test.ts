// src/lib/game/__tests__/worldTurnPacingRestore.test.ts
//
// Two properties of runWorldTurnIfDue's claim.
//
// 1. Integrity Engine Phase 3 — the claim spends the banked
//    hoursSinceWorldTurn BEFORE runWorldTurn runs, so a failure anywhere
//    inside it used to silently eat those hours with no retry. On a thrown
//    error, exactly what this attempt consumed is added back (not
//    overwritten), so a concurrent resolution's own banked hours aren't
//    clobbered and the next heartbeat retries the turn.
//
// 2. #376 — the claim is EXCLUSIVE. It used to claim by rewriting
//    hoursSinceWorldTurn under a `gte: threshold` guard, which does not
//    exclude: decideWorldTurnPacing caps banked overflow at one threshold,
//    so at acc >= 2*threshold the value written back is exactly the
//    threshold and still satisfies `gte`. With the heartbeat re-banking
//    ~24h/day, an idle campaign sits permanently on that boundary, so a
//    duplicate concurrent turn was the steady state rather than a rare
//    race. The lease column is what actually excludes.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const worldMeta = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(async () => ({})),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { worldMeta } }))
vi.mock('../worldTick', () => ({ runWorldTick: vi.fn(async () => { throw new Error('tick exploded') }) }))

import { runWorldTurnIfDue } from '../worldTurn'
import { WORLD_TURN_LEASE_TIMEOUT_MS } from '../tick/pacing'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runWorldTurnIfDue — restoring banked hours on failure', () => {
  it('adds back exactly what this attempt consumed when runWorldTurn throws', async () => {
    // 30 banked, 24h threshold (default) -> remainingHours = min(30-24, 24) = 6,
    // so this claim consumed 24 of the 30 banked hours.
    worldMeta.findUnique.mockResolvedValue({ hoursSinceWorldTurn: 30, worldTurnHours: null, worldTurnRunningSince: null })
    worldMeta.updateMany.mockResolvedValue({ count: 1 })

    await expect(runWorldTurnIfDue('camp1')).rejects.toThrow('tick exploded')

    expect(worldMeta.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ campaignId: 'camp1', hoursSinceWorldTurn: { gte: 24 } }),
        data: expect.objectContaining({ hoursSinceWorldTurn: 6 }),
      })
    )
    expect(worldMeta.update).toHaveBeenCalledWith({
      where: { campaignId: 'camp1' },
      data: { hoursSinceWorldTurn: { increment: 24 } },
    })
  })

  it('does not restore anything when the claim never landed (a concurrent resolution already ran it)', async () => {
    worldMeta.findUnique.mockResolvedValue({ hoursSinceWorldTurn: 30, worldTurnHours: null, worldTurnRunningSince: null })
    worldMeta.updateMany.mockResolvedValue({ count: 0 })

    const result = await runWorldTurnIfDue('camp1')

    expect(result).toEqual({ ran: false })
    expect(worldMeta.update).not.toHaveBeenCalled()
  })

  it('does not restore anything when the turn is not due at all', async () => {
    worldMeta.findUnique.mockResolvedValue({ hoursSinceWorldTurn: 5, worldTurnHours: null, worldTurnRunningSince: null })

    const result = await runWorldTurnIfDue('camp1')

    expect(result).toEqual({ ran: false })
    expect(worldMeta.updateMany).not.toHaveBeenCalled()
    expect(worldMeta.update).not.toHaveBeenCalled()
  })
})

describe('runWorldTurnIfDue — the claim is exclusive (#376)', () => {
  it('claims the lease alongside the accumulator, in one compare-and-set', async () => {
    worldMeta.findUnique.mockResolvedValue({ hoursSinceWorldTurn: 30, worldTurnHours: null, worldTurnRunningSince: null })
    worldMeta.updateMany.mockResolvedValue({ count: 1 })

    await expect(runWorldTurnIfDue('camp1')).rejects.toThrow('tick exploded')

    const claim = worldMeta.updateMany.mock.calls[0][0] as any
    // The lease is set in the SAME update as the accumulator, so the claim
    // stays one atomic compare-and-set — but now the post-state (a non-null
    // lease) genuinely fails the pre-state predicate.
    expect(claim.data.worldTurnRunningSince).toBeInstanceOf(Date)
    expect(claim.where.OR).toEqual([
      { worldTurnRunningSince: null },
      { worldTurnRunningSince: { lt: expect.any(Date) } },
    ])
  })

  it('refuses to start when another run already holds a live lease', async () => {
    // Banked well past the threshold — under the old `gte`-only claim this
    // is exactly the case that let a second turn run concurrently.
    worldMeta.findUnique.mockResolvedValue({
      hoursSinceWorldTurn: 48,
      worldTurnHours: null,
      worldTurnRunningSince: new Date(),
    })

    const result = await runWorldTurnIfDue('camp1')

    expect(result).toEqual({ ran: false })
    expect(worldMeta.updateMany).not.toHaveBeenCalled()
  })

  it('takes over a lease left behind by a killed run', async () => {
    // The cron sweep runs up to 25 turns against a maxDuration budget and
    // can be killed mid-turn. A plain boolean flag would wedge the campaign
    // forever; a lease expires.
    worldMeta.findUnique.mockResolvedValue({
      hoursSinceWorldTurn: 48,
      worldTurnHours: null,
      worldTurnRunningSince: new Date(Date.now() - WORLD_TURN_LEASE_TIMEOUT_MS - 1000),
    })
    worldMeta.updateMany.mockResolvedValue({ count: 1 })

    await expect(runWorldTurnIfDue('camp1')).rejects.toThrow('tick exploded')

    expect(worldMeta.updateMany).toHaveBeenCalled()
  })

  it('releases only its own lease, never a successor\'s', async () => {
    worldMeta.findUnique.mockResolvedValue({ hoursSinceWorldTurn: 30, worldTurnHours: null, worldTurnRunningSince: null })
    worldMeta.updateMany.mockResolvedValue({ count: 1 })

    await expect(runWorldTurnIfDue('camp1')).rejects.toThrow('tick exploded')

    const claimedAt = (worldMeta.updateMany.mock.calls[0][0] as any).data.worldTurnRunningSince
    const release = worldMeta.updateMany.mock.calls.at(-1)![0] as any
    // Keyed on the exact stamp this run wrote: if this run overran the
    // timeout and another legitimately took the lease over, the release
    // matches nothing rather than freeing the lease out from under it.
    expect(release).toEqual({
      where: { campaignId: 'camp1', worldTurnRunningSince: claimedAt },
      data: { worldTurnRunningSince: null },
    })
  })
})
