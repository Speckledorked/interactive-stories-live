// src/lib/game/tick/__tests__/worldChangeImportance.test.ts
//
// Regression for the WorldChange.importance 'MINOR' member (added PR #485).
//
// Intended semantics: MINOR = persisted history, never bus/digest-worthy.
// Quiet per-tick rows — war attrition and debt-repayment faction.resources
// changes — carry significant: false + importance: 'MINOR'. Every consumer
// below must handle that member without throwing, promoting it into the
// rumor bus / digest, or dropping it from history.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    worldEvent: {
      createManyAndReturn: vi.fn(),
      findMany: vi.fn(),
    },
    locationAdjacency: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/ai/memoryCreation', () => ({
  createCampaignMemory: vi.fn(),
  // Mirrors the real module's replay-key builder (pure string join) so the
  // assertions below check a real shape.
  memoryDedupeKey: (p: { memoryType: string; sourceId: string; turnNumber: number; title: string }) =>
    `${p.memoryType}|${p.sourceId}|${p.turnNumber}|${p.title}`,
}))

import { prisma } from '@/lib/prisma'
import { createCampaignMemory } from '@/lib/ai/memoryCreation'
import { persistWorldEvents } from '../worldEventLog'
import { logSignificantChanges } from '../historyLog'
import { tickInformation } from '../informationTick'
import { classifyWorldEvent } from '../beliefTick'
import { classifyFactionEvent } from '../npcDispositionTick'
import { selectDigestChanges } from '@/lib/notifications/world-digest'
import { compareJournalEvents, type JournalEventInput } from '@/lib/game/absenceJournal'
import type { WorldChange, TickContext } from '../types'
import { simTurn } from '@/lib/game/turnClock'

/** A quiet per-tick row, as warTick/economyTick emit since PR #485. */
function minorResourcesChange(overrides: Partial<WorldChange> = {}): WorldChange {
  return {
    entityType: 'FACTION',
    entityId: 'faction-1',
    entityName: 'The Rustwatch',
    campaignId: 'campaign-1',
    field: 'resources',
    previousValue: 60,
    newValue: 57,
    reason: 'war attrition',
    significant: false,
    importance: 'MINOR',
    ...overrides,
  }
}

function journalInput(overrides: Partial<JournalEventInput> = {}): JournalEventInput {
  return {
    id: 'e1',
    turnNumber: 10,
    createdAt: new Date('2026-09-28T12:00:00Z'),
    targetType: 'FACTION',
    targetId: 'faction-1',
    targetName: 'The Rustwatch',
    field: 'resources',
    significant: false,
    importance: 'MINOR',
    ...overrides,
  }
}

describe('history write path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persistWorldEvents persists MINOR rows to WorldEvent history', async () => {
    vi.mocked(prisma.worldEvent.createManyAndReturn).mockResolvedValue([
      { id: 'e1', significant: false },
    ] as any)
    const result = await persistWorldEvents('campaign-1', simTurn(5), [minorResourcesChange()])
    expect(result.count).toBe(1)
    const call = vi.mocked(prisma.worldEvent.createManyAndReturn).mock.calls[0][0] as any
    expect(call.data).toHaveLength(1)
    expect(call.data[0].importance).toBe('MINOR')
    expect(call.data[0].significant).toBe(false)
    expect(call.data[0].type).toBe('faction.resources')
  })

  it('logSignificantChanges skips MINOR rows — no paid embedding for per-tick quiet rows', async () => {
    vi.mocked(createCampaignMemory).mockResolvedValue('mem-1')
    const created = await logSignificantChanges('campaign-1', simTurn(5), [minorResourcesChange()])
    expect(created).toBe(0)
    expect(createCampaignMemory).not.toHaveBeenCalled()
  })

  it('logSignificantChanges still records significant rows (control)', async () => {
    vi.mocked(createCampaignMemory).mockResolvedValue('mem-1')
    const created = await logSignificantChanges('campaign-1', simTurn(5), [
      minorResourcesChange({ significant: true, importance: 'NORMAL' }),
    ])
    expect(created).toBe(1)
    expect(createCampaignMemory).toHaveBeenCalledTimes(1)
  })
})

describe('digest classifier', () => {
  it('selectDigestChanges excludes MINOR rows', () => {
    const discovered = new Set(['faction-1'])
    const minor = minorResourcesChange()
    // Even a hypothetical significant MINOR row is not digest-worthy:
    // digest requires MAJOR.
    const loudMinor = minorResourcesChange({ significant: true })
    const major = minorResourcesChange({
      significant: true,
      importance: 'MAJOR',
      field: 'warDeclared',
      previousValue: 'PEACE',
      newValue: 'WAR',
    })
    expect(selectDigestChanges([minor, loudMinor], discovered)).toEqual([])
    expect(selectDigestChanges([minor, loudMinor, major], discovered)).toEqual([major])
  })
})

describe('rumor bus intake', () => {
  it('tickInformation only queries significant WorldEvent rows', async () => {
    let capturedWhere: any = null
    const db = {
      locationAdjacency: { findMany: vi.fn().mockResolvedValue([]) },
      worldEvent: {
        findMany: vi.fn().mockImplementation(async (args: any) => {
          capturedWhere = args.where
          return []
        }),
      },
    }
    const ctx = {
      campaignId: 'campaign-1',
      turnNumber: simTurn(5),
      db,
    } as unknown as TickContext
    const result = await tickInformation(ctx)
    expect(result).toEqual({ changes: [] })
    expect(capturedWhere).not.toBeNull()
    // The bus never sees MINOR rows: intake is gated on significant.
    expect(capturedWhere.significant).toBe(true)
  })
})

describe('typed event consumers', () => {
  it('beliefTick ignores MINOR faction.resources rows', () => {
    expect(
      classifyWorldEvent({ type: 'faction.resources', newValue: '57', origin: 'tick', wakeSourceType: null })
    ).toBeNull()
  })

  it('beliefTick still classifies real war events (control)', () => {
    expect(
      classifyWorldEvent({ type: 'faction.warDeclared', newValue: null, origin: 'tick', wakeSourceType: null })
    ).not.toBeNull()
  })

  it('disposition treasury classifier consumes MINOR rows on band transition INTO low (intended)', () => {
    // 40 -> 30 crosses the 34 LOW threshold: the war-driven drop PR #485
    // un-blinded the detector for.
    expect(
      classifyFactionEvent({
        type: 'faction.resources',
        newValue: '30',
        previousValue: '40',
        origin: 'tick',
        wakeSourceType: null,
      })
    ).toEqual({ kind: 'TREASURY_COLLAPSED' })
  })

  it('disposition treasury classifier ignores routine MINOR wobbles and already-low treasuries', () => {
    // 60 -> 57: ordinary per-tick attrition, no band transition.
    expect(
      classifyFactionEvent({
        type: 'faction.resources',
        newValue: '57',
        previousValue: '60',
        origin: 'tick',
        wakeSourceType: null,
      })
    ).toBeNull()
    // 20 -> 18: already LOW, staying LOW is old news.
    expect(
      classifyFactionEvent({
        type: 'faction.resources',
        newValue: '18',
        previousValue: '20',
        origin: 'tick',
        wakeSourceType: null,
      })
    ).toBeNull()
  })
})

describe('absence journal ordering', () => {
  it('sorts MINOR rows below significant rows — they never displace real news', () => {
    const minor = journalInput({ turnNumber: 10 })
    const significant = journalInput({
      id: 'e2',
      importance: 'NORMAL',
      significant: true,
      turnNumber: 5, // older turn, still outranks
    })
    expect(compareJournalEvents(minor, significant)).toBeGreaterThan(0)
    expect(compareJournalEvents(significant, minor)).toBeLessThan(0)
  })
})
