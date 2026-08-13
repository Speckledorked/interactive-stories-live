// src/lib/game/tick/__tests__/historyLog.test.ts
//
// #236 (adversarial audit): logSignificantChanges used to return
// significant.length unconditionally — every candidate counted as
// "logged" regardless of whether createCampaignMemory actually
// succeeded. createCampaignMemory already fails open internally (a
// swallowed embedding-call failure returns false rather than throwing),
// so this never crashed, but historyEntriesCreated (surfaced in
// worldTurn.ts's turn summary) silently overclaimed how much of the
// tick's history actually made it into memory whenever an embedding call
// failed.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai/memoryCreation', () => ({ createCampaignMemory: vi.fn() }))

import { createCampaignMemory } from '@/lib/ai/memoryCreation'
import { logSignificantChanges } from '../historyLog'
import type { WorldChange } from '../types'

function factionChange(id: string, overrides: Partial<WorldChange> = {}): WorldChange {
  return {
    entityType: 'FACTION', entityId: id, entityName: `Faction ${id}`, campaignId: 'camp1',
    field: 'resources', previousValue: 50, newValue: 55, reason: 'x',
    significant: true, importance: 'NORMAL',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('logSignificantChanges', () => {
  it('counts only changes createCampaignMemory actually reports success for', async () => {
    vi.mocked(createCampaignMemory)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false) // embedding call failed for this one
      .mockResolvedValueOnce(true)

    const count = await logSignificantChanges('camp1', 5, [
      factionChange('f1'), factionChange('f2'), factionChange('f3'),
    ])

    expect(createCampaignMemory).toHaveBeenCalledTimes(3)
    expect(count).toBe(2)
  })

  it('returns 0, not the candidate count, when every write fails', async () => {
    vi.mocked(createCampaignMemory).mockResolvedValue(false)

    const count = await logSignificantChanges('camp1', 5, [factionChange('f1'), factionChange('f2')])

    expect(count).toBe(0)
  })

  it('filters out non-significant changes before ever calling createCampaignMemory', async () => {
    vi.mocked(createCampaignMemory).mockResolvedValue(true)

    const count = await logSignificantChanges('camp1', 5, [
      factionChange('f1'),
      factionChange('f2', { significant: false }),
    ])

    expect(createCampaignMemory).toHaveBeenCalledTimes(1)
    expect(count).toBe(1)
  })

  it('returns 0 for an empty batch without calling createCampaignMemory', async () => {
    const count = await logSignificantChanges('camp1', 5, [])
    expect(createCampaignMemory).not.toHaveBeenCalled()
    expect(count).toBe(0)
  })
})
