// src/lib/game/__tests__/world-state-tracker.test.ts
// #420: the transparency panel's diff read.
//
// This module had no tests at all, which is how it kept four unprojected,
// unbounded `findMany` calls running twice per scene resolution for a
// display-only panel. The bound is the fix; the interesting behaviour is
// what the bound does to the diff, because a naive LIMIT turns "this
// campaign has more NPCs than the cap" into "an NPC was removed from the
// campaign" — a fabricated world event, shown to the player as fact.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const findMany = {
  nPC: vi.fn(),
  faction: vi.fn(),
  clock: vi.fn(),
  character: vi.fn(),
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    nPC: { findMany: (args: unknown) => findMany.nPC(args) },
    faction: { findMany: (args: unknown) => findMany.faction(args) },
    clock: { findMany: (args: unknown) => findMany.clock(args) },
    character: { findMany: (args: unknown) => findMany.character(args) },
  },
}))

vi.mock('@/lib/notifications/notification-service', () => ({
  NotificationService: { createNotification: vi.fn() },
}))

import {
  captureWorldStateSnapshot,
  detectWorldStateChanges,
  ENTITY_READ_CAP,
} from '../world-state-tracker'

const npc = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `NPC ${id}`,
  description: 'someone',
  currentLocation: 'Old Town',
  goals: null,
  isAlive: true,
  ...over,
})

function withNpcs(npcs: unknown[]) {
  findMany.nPC.mockResolvedValue(npcs)
  findMany.faction.mockResolvedValue([])
  findMany.clock.mockResolvedValue([])
  findMany.character.mockResolvedValue([])
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchCampaignEntities bounds and projection (#420)', () => {
  it('projects to the diffed columns and bounds every table', async () => {
    withNpcs([npc('n1')])

    await captureWorldStateSnapshot('c1')

    for (const model of Object.values(findMany)) {
      const args = model.mock.calls[0][0]
      expect(args.take).toBe(ENTITY_READ_CAP)
      // Deterministic window, so before and after are the same set when
      // nothing changed.
      expect(args.orderBy).toEqual({ id: 'asc' })
      // The defect was `findMany({ where })` — every column, including the
      // long description/plan text the diff never reads.
      expect(args.select).toBeTruthy()
      expect(args.select.id).toBe(true)
    }
  })
})

describe('detectWorldStateChanges (#420)', () => {
  it('reports a genuine removal when the window is complete', async () => {
    withNpcs([npc('n1'), npc('n2')])
    const before = await captureWorldStateSnapshot('c1')

    withNpcs([npc('n1')])
    const changes = await detectWorldStateChanges('c1', before)

    expect(changes).toContainEqual(
      expect.objectContaining({ category: 'npc', type: 'removed', entityName: 'NPC n2' })
    )
  })

  it('reports no removals at all when the read hit the cap', async () => {
    // The failure mode this exists for: with the roster at or past the cap,
    // an NPC that fell off the LIMIT is indistinguishable from one that was
    // deleted. Every id outside the window would be reported as removed —
    // a wall of fabricated deaths on the campaign's transparency panel.
    const full = Array.from({ length: ENTITY_READ_CAP }, (_, i) => npc(`n${i}`))
    withNpcs(full)
    const before = await captureWorldStateSnapshot('c1')

    withNpcs(full.slice(1).concat(npc('zz-new')))
    const changes = await detectWorldStateChanges('c1', before)

    expect(changes.filter((c) => c.type === 'removed')).toEqual([])
  })

  it('still reports modifications inside a truncated window', async () => {
    // Suppression is scoped to REMOVALS. An NPC present in both windows was
    // genuinely observed twice, so a change between them is a real change.
    const full = Array.from({ length: ENTITY_READ_CAP }, (_, i) => npc(`n${i}`))
    withNpcs(full)
    const before = await captureWorldStateSnapshot('c1')

    withNpcs([npc('n0', { isAlive: false }), ...full.slice(1)])
    const changes = await detectWorldStateChanges('c1', before)

    expect(changes).toContainEqual(
      expect.objectContaining({ category: 'npc', entityName: 'NPC n0', details: 'died' })
    )
  })
})
