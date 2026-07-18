import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../embeddingService', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0.01)),
  embeddingToPostgresVector: vi.fn((embedding: number[]) => `[${embedding.join(',')}]`),
}))

vi.mock('../cost-tracker', () => ({
  recordAICost: vi.fn().mockResolvedValue(undefined),
  estimateTokenCount: vi.fn().mockReturnValue(10),
}))

import { prisma } from '@/lib/prisma'
import { generateEmbedding } from '../embeddingService'
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
  })

  it('embeds the summary text, not the full context', async () => {
    const data = makeMemoryData({ summary: 'short summary', fullContext: 'much longer full context text' })
    await createCampaignMemory(data)
    expect(generateEmbedding).toHaveBeenCalledWith('short summary')
  })

  it('writes exactly one row via raw SQL', async () => {
    await createCampaignMemory(makeMemoryData())
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
  })

  it('does not throw when embedding generation fails', async () => {
    vi.mocked(generateEmbedding).mockRejectedValueOnce(new Error('embedding service down'))
    await expect(createCampaignMemory(makeMemoryData())).resolves.toBeUndefined()
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it('does not throw when the DB write fails', async () => {
    vi.mocked(prisma.$executeRaw).mockRejectedValueOnce(new Error('db down'))
    await expect(createCampaignMemory(makeMemoryData())).resolves.toBeUndefined()
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
