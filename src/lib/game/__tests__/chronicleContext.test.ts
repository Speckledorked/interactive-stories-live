// src/lib/game/__tests__/chronicleContext.test.ts
// Covers the weather fallback chain and, most importantly, that the
// fog-of-war boundary (isActive/isDiscovered) is actually applied in the
// Prisma `where` clauses — a hidden villain faction's activity must never
// leak into lobby flavor text before the party has discovered it.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    worldMeta: { findUnique: vi.fn() },
    character: { findMany: vi.fn() },
    faction: { findMany: vi.fn() },
    war: { findMany: vi.fn() },
    timelineEvent: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { buildChronicleNarrationInput } from '../chronicleContext'

const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  db.campaign.findUnique.mockResolvedValue({ title: 'The Iron Vigil', universe: 'Grimdark Fantasy' })
  db.worldMeta.findUnique.mockResolvedValue({ tension: 40, phase: 'rising' })
  db.character.findMany.mockResolvedValue([])
  db.faction.findMany.mockResolvedValue([])
  db.war.findMany.mockResolvedValue([])
  db.timelineEvent.findMany.mockResolvedValue([])
})

describe('buildChronicleNarrationInput', () => {
  it('returns null when the campaign is missing', async () => {
    db.campaign.findUnique.mockResolvedValue(null)
    expect(await buildChronicleNarrationInput('camp1')).toBeNull()
  })

  it('returns null when worldMeta is missing', async () => {
    db.worldMeta.findUnique.mockResolvedValue(null)
    expect(await buildChronicleNarrationInput('camp1')).toBeNull()
  })

  it('filters factions to isActive && isDiscovered (fog of war)', async () => {
    await buildChronicleNarrationInput('camp1')
    expect(db.faction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ campaignId: 'camp1', isActive: true, isDiscovered: true }),
      })
    )
  })

  it('filters wars to both attacker and defender discovered (fog of war)', async () => {
    await buildChronicleNarrationInput('camp1')
    expect(db.war.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          campaignId: 'camp1',
          status: 'ESCALATING',
          attacker: { isDiscovered: true },
          defender: { isDiscovered: true },
        }),
      })
    )
  })

  it('filters recent events to PUBLIC/MIXED visibility only', async () => {
    await buildChronicleNarrationInput('camp1')
    expect(db.timelineEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ visibility: { in: ['PUBLIC', 'MIXED'] } }),
      })
    )
  })

  it('resolves weather via a character\'s locationId join when present', async () => {
    db.character.findMany.mockResolvedValue([
      { locationId: 'loc1', currentLocation: 'Greenstone', location: { name: 'Greenstone', weather: 'RAIN', weatherSeverity: 3 } },
    ])
    const result = await buildChronicleNarrationInput('camp1')
    expect(result?.weather).toEqual({ locationName: 'Greenstone', condition: 'RAIN', severity: 3 })
  })

  it('falls back to null weather when no character has a resolvable location', async () => {
    db.character.findMany.mockResolvedValue([{ locationId: null, currentLocation: null, location: null }])
    const result = await buildChronicleNarrationInput('camp1')
    expect(result?.weather).toBeNull()
  })

  it('never throws when every sub-query comes back empty', async () => {
    await expect(buildChronicleNarrationInput('camp1')).resolves.toEqual(
      expect.objectContaining({
        campaignTitle: 'The Iron Vigil',
        weather: null,
        factionSignals: [],
        activeWars: [],
        recentEvents: [],
      })
    )
  })

  it('defaults universe to "Generic Fantasy" when the campaign has none set', async () => {
    db.campaign.findUnique.mockResolvedValue({ title: 'T', universe: null })
    const result = await buildChronicleNarrationInput('camp1')
    expect(result?.universe).toBe('Generic Fantasy')
  })
})
