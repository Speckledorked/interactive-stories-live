// src/lib/ai/__tests__/worldSummary.questsCap.test.ts
//
// #244 (adversarial audit): buildOptimizedWorldSummary used to be the one
// place MAX_QUESTS_IN_PROMPT wasn't applied — its sibling builder,
// buildWorldSummaryForAI, capped the active-quest list before mapping it
// into the prompt; this one mapped the full, unbounded list straight
// through. Worse, buildOptimizedWorldSummary is the builder
// sceneResolutionRequest.ts picks once a campaign has 10+ scenes — exactly
// where an active-quest list is most likely to have grown past the cap.
//
// This test drives buildOptimizedWorldSummary through mocked Prisma calls
// (matching its own Promise.all shape) and proves the fix: with more
// active quests than MAX_QUESTS_IN_PROMPT, the mapped output is capped at
// exactly that many, keeping the most recently created ones.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    worldMeta: { findUnique: vi.fn() },
    character: { findMany: vi.fn() },
    nPC: { findMany: vi.fn() },
    faction: { findMany: vi.fn() },
    location: { findMany: vi.fn() },
    clock: { findMany: vi.fn() },
    war: { findMany: vi.fn() },
    quest: { findMany: vi.fn() },
    scene: { findMany: vi.fn() },
  },
}))

// buildOptimizedContext (contextManager.ts) does its own separate DB
// reads (recent scenes, campaign summary) unrelated to this fix — stub it
// directly rather than mocking every prisma.scene.findMany shape it needs,
// while keeping the real capForPrompt/clampPromptStrings this file also
// imports from the same module.
vi.mock('../contextManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../contextManager')>()
  return {
    ...actual,
    buildOptimizedContext: vi.fn(async () => ({
      recentScenes: [],
      compressedHistory: [],
      importantMoments: [],
      campaignSummary: undefined,
    })),
  }
})

import { prisma } from '@/lib/prisma'
import { buildOptimizedWorldSummary } from '../worldSummary'
import { MAX_QUESTS_IN_PROMPT } from '../worldSummaryMappers'

const db = prisma as any

function baseWorldMeta() {
  return {
    campaignId: 'camp1',
    currentTurnNumber: 5,
    tension: 20,
    phase: null,
    currentInGameDate: 'Day 3',
    totalElapsedGameHours: 72,
    campaign: { calendarConfig: null },
  }
}

function questAt(id: string, createdAt: Date) {
  return {
    id,
    campaignId: 'camp1',
    name: `Quest ${id}`,
    description: 'x',
    objective: 'x',
    givenBy: null,
    progressLog: null,
    status: 'ACTIVE',
    createdAt,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.worldMeta.findUnique.mockResolvedValue(baseWorldMeta())
  db.character.findMany.mockResolvedValue([])
  db.nPC.findMany.mockResolvedValue([])
  db.faction.findMany.mockResolvedValue([])
  db.location.findMany.mockResolvedValue([])
  db.clock.findMany.mockResolvedValue([])
  db.war.findMany.mockResolvedValue([])
})

describe('buildOptimizedWorldSummary — quest cap (#244)', () => {
  it('caps the mapped quest list at MAX_QUESTS_IN_PROMPT, keeping the most recently created', async () => {
    const totalQuests = MAX_QUESTS_IN_PROMPT + 5
    const quests = Array.from({ length: totalQuests }, (_, i) =>
      questAt(`q${i}`, new Date(2026, 0, i + 1)) // ascending creation order
    )
    db.quest.findMany.mockResolvedValue(quests)

    const { worldSummary } = await buildOptimizedWorldSummary('camp1', 20, null)

    expect(worldSummary.quests).toHaveLength(MAX_QUESTS_IN_PROMPT)
    const keptNames = new Set((worldSummary.quests ?? []).map((q: any) => q.name))
    // The most recently created MAX_QUESTS_IN_PROMPT quests are q5..q13 for
    // MAX_QUESTS_IN_PROMPT=8 and totalQuests=13 (indices 0..12, kept = last 8).
    const expectedKeptIndices = Array.from({ length: MAX_QUESTS_IN_PROMPT }, (_, i) => totalQuests - 1 - i)
    for (const i of expectedKeptIndices) {
      expect(keptNames.has(`Quest q${i}`)).toBe(true)
    }
    // The oldest quest must have been dropped, not kept alongside everything else.
    expect(keptNames.has('Quest q0')).toBe(false)
  })

  it('passes every quest through unfiltered when there are fewer than the cap', async () => {
    const quests = [questAt('q0', new Date(2026, 0, 1)), questAt('q1', new Date(2026, 0, 2))]
    db.quest.findMany.mockResolvedValue(quests)

    const { worldSummary } = await buildOptimizedWorldSummary('camp1', 20, null)

    expect(worldSummary.quests).toHaveLength(2)
  })
})
