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
import { buildChronicleNarrationInput, deriveChronicleGlance } from '../chronicleContext'
import type { ChronicleNarrationInput } from '../chronicleTypes'

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

describe('deriveChronicleGlance', () => {
  const baseInput: ChronicleNarrationInput = {
    campaignTitle: 'The Iron Vigil',
    universe: 'Grimdark Fantasy',
    tension: 40,
    phase: 'rising',
    weather: null,
    factionSignals: [],
    activeWars: [],
    recentEvents: [],
  }

  it('derives a null weatherLabel/weatherLocationName and topFaction, zero counts, from an empty input', () => {
    expect(deriveChronicleGlance(baseInput)).toEqual({
      weatherLabel: null,
      weatherLocationName: null,
      topFaction: null,
      activeConflictCount: 0,
      recentEventCount: 0,
    })
  })

  it('formats weatherLabel from condition + location name, and carries the bare location name separately, when weather is present', () => {
    const result = deriveChronicleGlance({
      ...baseInput,
      weather: { locationName: 'Greenstone', condition: 'RAIN', severity: 3 },
    })
    expect(result.weatherLabel).toBe('RAIN in Greenstone')
    expect(result.weatherLocationName).toBe('Greenstone')
  })

  it('takes the first (highest-threat) faction as topFaction, ignoring the rest', () => {
    const result = deriveChronicleGlance({
      ...baseInput,
      factionSignals: [
        { name: 'The Ashen Court', archetype: 'cabal', goal: 'seize the throne', stability: 40, threatLevel: 80, currentPlan: null },
        { name: 'Free Traders', archetype: 'guild', goal: 'profit', stability: 70, threatLevel: 20, currentPlan: null },
      ],
    })
    expect(result.topFaction).toEqual({ name: 'The Ashen Court', threatLevel: 80 })
  })

  it('counts active wars and recent events directly from their array lengths', () => {
    const result = deriveChronicleGlance({
      ...baseInput,
      activeWars: [
        { name: 'War of Ash', attackerName: 'A', defenderName: 'B', momentum: 10, status: 'ESCALATING' },
      ],
      recentEvents: [
        { title: 'Ambush', summaryPublic: 'An ambush occurred.' },
        { title: 'Treaty', summaryPublic: null },
      ],
    })
    expect(result.activeConflictCount).toBe(1)
    expect(result.recentEventCount).toBe(2)
  })
})
