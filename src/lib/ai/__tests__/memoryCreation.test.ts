import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    memoryCreationFailure: { create: vi.fn().mockResolvedValue({}) },
  },
}))

vi.mock('../embeddingService', () => ({
  embedWithCostTracking: vi.fn().mockResolvedValue('[0.01,0.01]'),
}))

import { prisma } from '@/lib/prisma'
import { embedWithCostTracking } from '../embeddingService'
import { createCampaignMemory, determineImportance, extractTags, type MemoryData } from '../memoryCreation'
import type { Scene } from '@prisma/client'

function makeMemoryData(overrides: Partial<MemoryData> = {}): MemoryData {
  return {
    campaignId: 'campaign-1',
    memoryType: 'SCENE',
    sourceId: 'scene-1',
    turnNumber: 3,
    title: 'A scene happened',
    summary: 'Something happened in the scene.',
    fullContext: 'Full text of the scene resolution.',
    involvedCharacterIds: [],
    involvedNpcIds: [],
    involvedFactionIds: [],
    locationTags: [],
    importance: 'NORMAL',
    tags: [],
    ...overrides,
  }
}

describe('createCampaignMemory (baseline)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks resets call history but not a persistent
    // mockRejectedValue/mockResolvedValue implementation set by an earlier
    // test — re-establish clean defaults every test so one test's failure
    // scenario can't leak into the next.
    vi.mocked(embedWithCostTracking).mockResolvedValue('[0.01,0.01]')
    vi.mocked(prisma.$executeRaw).mockResolvedValue(undefined as any)
    vi.mocked(prisma.memoryCreationFailure.create).mockResolvedValue({} as any)
  })

  it('embeds the summary text, not the full context', async () => {
    const data = makeMemoryData({ summary: 'short summary', fullContext: 'much longer full context text' })
    await createCampaignMemory(data)
    expect(embedWithCostTracking).toHaveBeenCalledWith('campaign-1', 'short summary', 'memory_embedding')
  })

  it('writes exactly one row via raw SQL', async () => {
    await createCampaignMemory(makeMemoryData())
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
  })

  // #216: the return value now signals success/failure (memoryConsolidation.ts's
  // create-then-delete loop needs to know before it deletes anything) —
  // previously a bare Promise<void>, so every caller here still just
  // `await`s it, but this file pins the actual contract.
  it('resolves true on a successful write', async () => {
    await expect(createCampaignMemory(makeMemoryData())).resolves.toBe(true)
  })

  // #284: a single transient embedding failure is retried once before
  // giving up, so this doesn't fail the whole memory over a momentary
  // blip.
  it('retries once after a transient embedding failure and succeeds', async () => {
    vi.mocked(embedWithCostTracking).mockRejectedValueOnce(new Error('rate limited'))
    await expect(createCampaignMemory(makeMemoryData())).resolves.toBe(true)
    expect(embedWithCostTracking).toHaveBeenCalledTimes(2)
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    expect(prisma.memoryCreationFailure.create).not.toHaveBeenCalled()
  })

  it('does not throw when embedding generation fails twice in a row, and resolves false', async () => {
    vi.mocked(embedWithCostTracking).mockRejectedValue(new Error('embedding service down'))
    await expect(createCampaignMemory(makeMemoryData())).resolves.toBe(false)
    expect(embedWithCostTracking).toHaveBeenCalledTimes(2)
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it('does not throw when the DB write fails, and resolves false', async () => {
    vi.mocked(prisma.$executeRaw).mockRejectedValueOnce(new Error('db down'))
    await expect(createCampaignMemory(makeMemoryData())).resolves.toBe(false)
  })

  // #284: the actual fix — a lost memory used to vanish into a
  // console.error with nothing queryable anywhere. Both failure paths
  // (embedding and the raw-SQL write) must persist a recoverable record.
  describe('MemoryCreationFailure recording (#284)', () => {
    it('records a queryable failure — not just a console log — when embedding fails permanently', async () => {
      vi.mocked(embedWithCostTracking).mockRejectedValue(new Error('embedding service down'))
      const data = makeMemoryData({ title: 'The party confronts the Duke' })

      await createCampaignMemory(data)

      expect(prisma.memoryCreationFailure.create).toHaveBeenCalledWith({
        data: {
          campaignId: 'campaign-1',
          memoryType: 'SCENE',
          sourceId: 'scene-1',
          turnNumber: 3,
          errorMessage: 'embedding service down',
          data,
        },
      })
    })

    it('records a queryable failure when the raw-SQL write fails', async () => {
      vi.mocked(prisma.$executeRaw).mockRejectedValueOnce(new Error('connection reset'))
      const data = makeMemoryData()

      await createCampaignMemory(data)

      expect(prisma.memoryCreationFailure.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ errorMessage: 'connection reset', data }),
        })
      )
    })

    it('preserves the full memory payload in the failure record, not just a summary', async () => {
      vi.mocked(embedWithCostTracking).mockRejectedValue(new Error('down'))
      const data = makeMemoryData({
        involvedNpcIds: ['npc-1', 'npc-2'],
        involvedFactionIds: ['faction-1'],
        tags: ['combat', 'relationships'],
      })

      await createCampaignMemory(data)

      const call = vi.mocked(prisma.memoryCreationFailure.create).mock.calls[0][0]
      expect(call.data.data).toEqual(data)
    })

    it('a best-effort failure-record write never itself throws out of createCampaignMemory', async () => {
      vi.mocked(embedWithCostTracking).mockRejectedValue(new Error('down'))
      vi.mocked(prisma.memoryCreationFailure.create).mockRejectedValueOnce(new Error('audit table unavailable too'))

      await expect(createCampaignMemory(makeMemoryData())).resolves.toBe(false)
    })
  })
})

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    sceneType: null,
    sceneResolutionText: null,
    ...overrides,
  } as Scene
}

// Regression coverage for the field-name bug: these two functions used to
// read `character_updates`/`clock_updates`/`faction_updates`/`timeline_events`,
// none of which exist on the real AIGMResponse.world_updates shape
// (lib/ai/client.ts uses pc_changes/clock_changes/faction_changes/
// new_timeline_events) — every scene silently graded as 'NORMAL' regardless
// of what actually happened. These tests pin the real shape so that
// regression can't land silently again.
describe('determineImportance', () => {
  it('is CRITICAL when a character takes severe harm damage', () => {
    const aiResponse = { world_updates: { pc_changes: [{ character_name_or_id: 'Jason', changes: { harm_damage: 5 } }] } }
    expect(determineImportance(makeScene(), aiResponse)).toBe('CRITICAL')
  })

  it('is CRITICAL on a failed death save', () => {
    const aiResponse = { world_updates: { pc_changes: [{ character_name_or_id: 'Jason', changes: { death_save_result: 'failure' } }] } }
    expect(determineImportance(makeScene(), aiResponse)).toBe('CRITICAL')
  })

  it('is CRITICAL on a heroic sacrifice', () => {
    const aiResponse = { world_updates: { pc_changes: [{ character_name_or_id: 'Jason', changes: { heroic_sacrifice: { circumstances: 'held the line', effect: 'saved the party' } } }] } }
    expect(determineImportance(makeScene(), aiResponse)).toBe('CRITICAL')
  })

  it('is CRITICAL when a new timeline event mentions death', () => {
    const aiResponse = { world_updates: { new_timeline_events: [{ title: 'The Duke\'s Death', summary_public: '', summary_gm: '', is_offscreen: false, visibility: 'PUBLIC' }] } }
    expect(determineImportance(makeScene(), aiResponse)).toBe('CRITICAL')
  })

  it('is MAJOR when a clock changes', () => {
    const aiResponse = { world_updates: { clock_changes: [{ clock_name_or_id: 'The Ritual Nears', delta: 1 }] } }
    expect(determineImportance(makeScene(), aiResponse)).toBe('MAJOR')
  })

  it('is MAJOR when a faction changes', () => {
    const aiResponse = { world_updates: { faction_changes: [{ faction_name_or_id: 'Iron Company', changes: { current_plan: 'Consolidate power' } }] } }
    expect(determineImportance(makeScene(), aiResponse)).toBe('MAJOR')
  })

  it('is MAJOR for a combat scene with no other updates', () => {
    expect(determineImportance(makeScene({ sceneType: 'combat' }), { world_updates: {} })).toBe('MAJOR')
  })

  it('is MINOR for a downtime scene with no timeline events', () => {
    expect(determineImportance(makeScene({ sceneType: 'downtime' }), { world_updates: {} })).toBe('MINOR')
  })

  it('is NORMAL with no notable updates', () => {
    expect(determineImportance(makeScene(), { world_updates: {} })).toBe('NORMAL')
  })

  it('is NORMAL (not CRITICAL) for a minor harm hit', () => {
    const aiResponse = { world_updates: { pc_changes: [{ character_name_or_id: 'Jason', changes: { harm_damage: 1 } }] } }
    expect(determineImportance(makeScene(), aiResponse)).toBe('NORMAL')
  })
})

describe('extractTags', () => {
  it('tags relationship changes from pc_changes', () => {
    const aiResponse = { world_updates: { pc_changes: [{ character_name_or_id: 'Jason', changes: { relationship_changes: [{ entity_id: 'npc-1', entity_name: 'Kessler', trust_delta: 5, reason: 'helped them' }] } }] } }
    expect(extractTags(makeScene(), aiResponse)).toContain('relationships')
  })

  it('tags consequences added from pc_changes', () => {
    const aiResponse = { world_updates: { pc_changes: [{ character_name_or_id: 'Jason', changes: { consequences_add: [{ type: 'enemy', description: 'The Iron Company wants them dead' }] } }] } }
    expect(extractTags(makeScene(), aiResponse)).toContain('consequences')
  })

  it('tags consequences removed from pc_changes', () => {
    const aiResponse = { world_updates: { pc_changes: [{ character_name_or_id: 'Jason', changes: { consequences_remove: ['an old debt'] } }] } }
    expect(extractTags(makeScene(), aiResponse)).toContain('consequences')
  })

  it('tags clock progression', () => {
    const aiResponse = { world_updates: { clock_changes: [{ clock_name_or_id: 'The Ritual Nears', delta: 1 }] } }
    expect(extractTags(makeScene(), aiResponse)).toContain('clock_progression')
  })

  it('does not tag relationships/consequences/clock_progression with no matching updates', () => {
    const tags = extractTags(makeScene(), { world_updates: {} })
    expect(tags).not.toContain('relationships')
    expect(tags).not.toContain('consequences')
    expect(tags).not.toContain('clock_progression')
  })

  it('still tags scene type and keyword-derived tags from resolution text', () => {
    const tags = extractTags(makeScene({ sceneType: 'combat', sceneResolutionText: 'They draw steel and attack the guards.' }), { world_updates: {} })
    expect(tags).toContain('combat')
  })
})
