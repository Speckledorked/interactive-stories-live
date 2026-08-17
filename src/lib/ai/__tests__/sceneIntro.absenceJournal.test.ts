// src/lib/ai/__tests__/sceneIntro.absenceJournal.test.ts
//
// #445: the scene opener is told what the DURABLE record says happened while
// nobody was watching.
//
// #396 built the absence journal off WorldEvent precisely because
// TimelineEvent is the narrated feed and misses whole categories — a clock
// advancing, a debt cascading, a war resolving. It fog-gated it, made it
// idempotent, made it coverage-first, and connected it to the lobby UI. No
// file under src/lib/ai read it. So the AI still had no "what changed while
// you were gone" input, which the issue notes "was the point."
//
// sceneIntro's own offscreen block read TimelineEvent — the incomplete record.
// The test that matters here is the one where a WorldEvent has NO matching
// TimelineEvent, because that is the case the old code could not see at all.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignSafetySettings: { findUnique: vi.fn() },
    campaign: { findUnique: vi.fn() },
    scene: { findFirst: vi.fn() },
    timelineEvent: { findMany: vi.fn() },
    worldEvent: { findMany: vi.fn(), aggregate: vi.fn() },
    faction: { findMany: vi.fn() },
    nPC: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/ai/chatCompletion', () => ({ callChatCompletion: vi.fn() }))
vi.mock('../worldSummary', () => ({
  buildWorldSummaryForAI: vi.fn(async () => ({ worldSummary: {} })),
}))
vi.mock('../cost-tracker', () => ({
  recordAICost: vi.fn(async () => {}),
  estimateTokenCount: vi.fn(() => 10),
}))
vi.mock('@/lib/monitoring', () => ({ reportError: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { callChatCompletion } from '@/lib/ai/chatCompletion'
import { generateNewSceneIntro } from '../sceneIntro'

const db = prisma as any

/** The prompt the model was actually handed. */
function promptSent(): string {
  return String(vi.mocked(callChatCompletion).mock.calls[0]![0].userPrompt)
}

const LAST_SCENE_AT = new Date('2026-02-01')

beforeEach(() => {
  vi.clearAllMocks()
  process.env.OPENAI_API_KEY = 'test-key'
  db.campaignSafetySettings.findUnique.mockResolvedValue(null)
  db.campaign.findUnique.mockResolvedValue({
    id: 'camp1', name: 'The Ashen Reach', universe: 'Generic Fantasy',
    aiSystemPrompt: null, description: null, tone: null, characters: [],
  })
  db.scene.findFirst.mockResolvedValue({ id: 's1', updatedAt: LAST_SCENE_AT, sceneResolutionText: 'It ended badly.' })
  db.timelineEvent.findMany.mockResolvedValue([])
  db.worldEvent.findMany.mockResolvedValue([])
  db.worldEvent.aggregate.mockResolvedValue({ _count: { _all: 0 }, _min: { turnNumber: null }, _max: { turnNumber: null } })
  db.faction.findMany.mockResolvedValue([])
  db.nPC.findMany.mockResolvedValue([])
  vi.mocked(callChatCompletion).mockResolvedValue({
    ok: true, status: 200, content: 'Rain on the flagstones.', usage: { prompt_tokens: 1, completion_tokens: 1 },
  } as never)
})

describe('the scene opener reads the durable record (#445)', () => {
  it('reaches a clock advance that produced no TimelineEvent at all', async () => {
    // The exact gap. Nothing narrated this; TimelineEvent is empty. Before
    // this fix the opener had no way to know it happened.
    db.worldEvent.findMany.mockResolvedValue([
      {
        id: 'w1', turnNumber: 12, createdAt: new Date('2026-02-02'),
        targetType: 'CLOCK', targetId: 'k1', targetName: 'The Siege of Ore Hills',
        field: 'currentTicks', significant: true, importance: 'MAJOR',
      },
    ])

    await generateNewSceneIntro('camp1')

    expect(promptSent()).toContain('OFFSCREEN DEVELOPMENTS')
    expect(promptSent()).toContain('The Siege of Ore Hills')
  })

  it('scans from the last scene, not from the start of the campaign', async () => {
    await generateNewSceneIntro('camp1')

    const where = db.worldEvent.findMany.mock.calls[0][0].where
    expect(where.createdAt).toEqual({ gt: LAST_SCENE_AT })
  })

  it('never mentions an undiscovered faction', async () => {
    // Fog is the reason this goes through loadAbsenceJournal instead of a
    // second WorldEvent query written here — a second copy of the rule is
    // how the rule gets broken.
    db.worldEvent.findMany.mockResolvedValue([
      {
        id: 'w1', turnNumber: 12, createdAt: new Date('2026-02-02'),
        targetType: 'FACTION', targetId: 'secret', targetName: 'The Hollow Choir',
        field: 'collapsed', significant: true, importance: 'MAJOR',
      },
    ])
    db.faction.findMany.mockResolvedValue([]) // nothing discovered

    await generateNewSceneIntro('camp1')

    expect(promptSent()).not.toContain('Hollow Choir')
  })

  it('does not describe the same development twice in two voices', async () => {
    // A development that DID produce a TimelineEvent is already in the
    // narrated block; repeating it as a journal line would have the opener
    // told about it twice, worded differently.
    db.timelineEvent.findMany.mockResolvedValue([
      { title: 'The siege tightens', summaryPublic: 'Ore Hills is encircled.' },
    ])
    db.worldEvent.findMany.mockResolvedValue([
      {
        id: 'w1', turnNumber: 12, createdAt: new Date('2026-02-02'),
        targetType: 'CLOCK', targetId: 'k1', targetName: 'The siege tightens',
        field: 'currentTicks', significant: true, importance: 'MAJOR',
      },
    ])

    await generateNewSceneIntro('camp1')

    const occurrences = promptSent().split('The siege tightens').length - 1
    expect(occurrences).toBe(1)
  })

  it('bounds how many background developments the opener is handed', async () => {
    // An opener asked to weave a dozen background developments into
    // atmosphere weaves none of them. The journal is coverage-first, so the
    // first few lines are the ones worth having.
    db.worldEvent.findMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        id: `w${i}`, turnNumber: 12, createdAt: new Date('2026-02-02'),
        targetType: 'CLOCK', targetId: `k${i}`, targetName: `Countdown ${i}`,
        field: 'currentTicks', significant: true, importance: 'MAJOR',
      }))
    )

    await generateNewSceneIntro('camp1')

    const mentioned = Array.from({ length: 12 }, (_, i) => `Countdown ${i}`)
      .filter((name) => promptSent().includes(name))
    expect(mentioned.length).toBeLessThanOrEqual(4)
    expect(mentioned.length).toBeGreaterThan(0)
  })

  it('still produces an opener when the journal read fails', async () => {
    // An opener with less context is a worse opener; an opener that throws is
    // no scene at all. Same fail-open posture as every other enrichment here.
    db.worldEvent.findMany.mockRejectedValue(new Error('db down'))

    await expect(generateNewSceneIntro('camp1')).resolves.toBe('Rain on the flagstones.')
  })

  it('omits the section entirely when nothing happened', async () => {
    await generateNewSceneIntro('camp1')
    expect(promptSent()).not.toContain('OFFSCREEN DEVELOPMENTS')
  })
})
