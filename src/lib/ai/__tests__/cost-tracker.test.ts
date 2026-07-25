// src/lib/ai/__tests__/cost-tracker.test.ts
// Regression coverage for a 1000x overbilling bug: gpt-5.4/gpt-5.4-mini/
// gpt-4.1/gpt-4.1-mini are priced per MILLION tokens on OpenAI's pricing
// page, but AI_PRICING used to divide those same numerators by 1,000 —
// the convention correct only for the older per-1K-token models below them
// in the table. Every real call (these are the models src/lib/ai/models.ts
// actually routes to) got billed 1000x its real cost, which is how a scene
// that should cost cents ended up demanding $1,459.77 to resolve.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    worldMeta: {
      findUnique: vi.fn().mockResolvedValue({ id: 'meta-1', campaignId: 'camp1', aiMetrics: null }),
      update: vi.fn().mockResolvedValue({}),
    },
    aICostEntry: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import { recordAICost } from '../cost-tracker'

const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  db.worldMeta.findUnique.mockResolvedValue({ id: 'meta-1', campaignId: 'camp1', aiMetrics: null })
})

describe('AI_PRICING — per-million vs per-1K models', () => {
  it('bills gpt-4.1 at its real published per-million rate ($2.00 in / $8.00 out per 1M tokens)', async () => {
    await recordAICost({
      campaignId: 'camp1',
      model: 'gpt-4.1',
      requestType: 'scene_resolution',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      responseTimeMs: 1000,
      success: true,
      sceneId: 'scene1',
    })

    const call = db.aICostEntry.create.mock.calls[0][0]
    // $2.00 + $8.00 = $10.00 = 10_000_000 micros. The pre-fix formula
    // (numerator / 1000) would have recorded 1000x that.
    expect(call.data.costMicros).toBe(10_000_000)
  })

  it('bills gpt-5.4 (the active flagship model) at a realistic per-scene cost, not a 1000x-inflated one', async () => {
    // A generous single scene-resolution call: a few thousand tokens of
    // context in, under a thousand tokens of narration out.
    await recordAICost({
      campaignId: 'camp1',
      model: 'gpt-5.4',
      requestType: 'scene_resolution',
      inputTokens: 4000,
      outputTokens: 800,
      responseTimeMs: 1000,
      success: true,
      sceneId: 'scene1',
    })

    const call = db.aICostEntry.create.mock.calls[0][0]
    const costDollars = call.data.costMicros / 1_000_000
    // 4000 * (2.5/1e6) + 800 * (15/1e6) = 0.01 + 0.012 = $0.022 — a few
    // cents, matching resolutionBilling.ts's own "a few cents at most per
    // scene" expectation. The pre-fix bug would have recorded ~$22.
    expect(costDollars).toBeCloseTo(0.022, 5)
    expect(costDollars).toBeLessThan(1)
  })

  it('still bills legacy per-1K models (gpt-4) at their real per-1K rate, unaffected by the per-million fix', async () => {
    await recordAICost({
      campaignId: 'camp1',
      model: 'gpt-4',
      requestType: 'scene_resolution',
      inputTokens: 1000,
      outputTokens: 1000,
      responseTimeMs: 1000,
      success: true,
      sceneId: 'scene1',
    })

    const call = db.aICostEntry.create.mock.calls[0][0]
    // $0.03 + $0.06 = $0.09 = 90_000 micros, per OpenAI's real historical
    // per-1K-token gpt-4 pricing.
    expect(call.data.costMicros).toBe(90_000)
  })
})
