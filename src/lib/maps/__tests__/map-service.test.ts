// src/lib/maps/__tests__/map-service.test.ts
//
// Map accumulation cleanup (#9/#59). Generation creates a fresh
// Map+Zone+Token set whenever the AI decides a scene isn't reusing a
// location, and nothing ever removed old ones — a long campaign
// accumulated a map per distinct location forever.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    map: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import { MapService, MAX_MAPS_PER_CAMPAIGN } from '../map-service'

const maps = (count: number, opts: { activeIndex?: number } = {}) =>
  Array.from({ length: count }, (_, i) => ({
    id: `map-${i}`,
    // findMany is ordered createdAt desc, so index 0 is the newest.
    isActive: opts.activeIndex === i,
  }))

beforeEach(() => {
  vi.clearAllMocks()
  ;(prisma.map.deleteMany as any).mockResolvedValue({ count: 0 })
})

describe('MapService.pruneOldMaps', () => {
  it('does nothing when the campaign is under the cap', async () => {
    ;(prisma.map.findMany as any).mockResolvedValue(maps(MAX_MAPS_PER_CAMPAIGN - 1))
    const pruned = await MapService.pruneOldMaps('camp1')
    expect(pruned).toBe(0)
    expect(prisma.map.deleteMany).not.toHaveBeenCalled()
  })

  it('does nothing at exactly the cap', async () => {
    ;(prisma.map.findMany as any).mockResolvedValue(maps(MAX_MAPS_PER_CAMPAIGN))
    const pruned = await MapService.pruneOldMaps('camp1')
    expect(pruned).toBe(0)
    expect(prisma.map.deleteMany).not.toHaveBeenCalled()
  })

  it('deletes the oldest maps once over the cap, keeping the newest', async () => {
    const over = 3
    ;(prisma.map.findMany as any).mockResolvedValue(maps(MAX_MAPS_PER_CAMPAIGN + over))
    ;(prisma.map.deleteMany as any).mockResolvedValue({ count: over })

    const pruned = await MapService.pruneOldMaps('camp1')

    expect(pruned).toBe(over)
    const deletedIds = (prisma.map.deleteMany as any).mock.calls[0][0].where.id.in
    expect(deletedIds).toHaveLength(over)
    // Ordered newest-first, so the tail is the oldest.
    expect(deletedIds).toEqual([
      `map-${MAX_MAPS_PER_CAMPAIGN}`,
      `map-${MAX_MAPS_PER_CAMPAIGN + 1}`,
      `map-${MAX_MAPS_PER_CAMPAIGN + 2}`,
    ])
    // The newest map is never in the delete set.
    expect(deletedIds).not.toContain('map-0')
  })

  it('never prunes the active map, even when it is the oldest', async () => {
    // The active map may be rendering in a live scene right now; deleting it
    // would blank the player's view mid-scene.
    const all = maps(MAX_MAPS_PER_CAMPAIGN + 2, { activeIndex: MAX_MAPS_PER_CAMPAIGN + 1 })
    ;(prisma.map.findMany as any).mockResolvedValue(all)
    ;(prisma.map.deleteMany as any).mockResolvedValue({ count: 1 })

    await MapService.pruneOldMaps('camp1')

    const deletedIds = (prisma.map.deleteMany as any).mock.calls[0][0].where.id.in
    expect(deletedIds).not.toContain(`map-${MAX_MAPS_PER_CAMPAIGN + 1}`)
    expect(deletedIds).toEqual([`map-${MAX_MAPS_PER_CAMPAIGN}`])
  })

  it('is a no-op when every over-cap map is the active one', async () => {
    const all = maps(MAX_MAPS_PER_CAMPAIGN + 1, { activeIndex: MAX_MAPS_PER_CAMPAIGN })
    ;(prisma.map.findMany as any).mockResolvedValue(all)

    const pruned = await MapService.pruneOldMaps('camp1')

    expect(pruned).toBe(0)
    expect(prisma.map.deleteMany).not.toHaveBeenCalled()
  })

  it('honors an explicit cap override', async () => {
    ;(prisma.map.findMany as any).mockResolvedValue(maps(5))
    ;(prisma.map.deleteMany as any).mockResolvedValue({ count: 3 })

    const pruned = await MapService.pruneOldMaps('camp1', 2)

    expect(pruned).toBe(3)
    const deletedIds = (prisma.map.deleteMany as any).mock.calls[0][0].where.id.in
    expect(deletedIds).toEqual(['map-2', 'map-3', 'map-4'])
  })

  it('scopes the lookup to the campaign and orders newest-first', async () => {
    ;(prisma.map.findMany as any).mockResolvedValue([])
    await MapService.pruneOldMaps('camp-xyz')
    expect(prisma.map.findMany).toHaveBeenCalledWith({
      where: { campaignId: 'camp-xyz' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, isActive: true },
    })
  })
})
