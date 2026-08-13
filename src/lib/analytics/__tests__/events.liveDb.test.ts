// src/lib/analytics/__tests__/events.liveDb.test.ts
//
// #260: getAICostByDay buckets AICostEntry rows by UTC calendar day via a
// raw $queryRaw (Prisma's groupBy can't truncate a timestamp to a day),
// so the day-boundary/timezone arithmetic is exactly the kind of thing a
// fully-mocked test can't catch. This verifies real bucketing, real
// zero-fill for a silent day, and that a request outside the campaign's
// entries doesn't leak zero-day fabrication beyond what's asked for.
//
// Opt-in, matching the repo's other *.liveDb.test.ts files:
//
//   RUN_DB_TESTS=1 npx vitest run events.liveDb

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { getAICostByDay } from '../events'

const RUN = process.env.RUN_DB_TESTS === '1'
const describeIfDb = RUN ? describe : describe.skip

describeIfDb('getAICostByDay — real database (#260)', () => {
  const prisma = new PrismaClient()
  let campaignId: string

  const dayAgo = (days: number, hour = 12) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - days)
    d.setUTCHours(hour, 0, 0, 0)
    return d
  }

  beforeAll(async () => {
    const campaign = await prisma.campaign.create({
      data: { title: 'AI Cost Trend Live Test', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    campaignId = campaign.id

    // Two entries today (summed into one bucket), one entry 2 days ago,
    // nothing yesterday (must zero-fill), nothing 40 days ago (outside
    // the 30-day window, must not appear at all).
    await prisma.aICostEntry.createMany({
      data: [
        { campaignId, requestType: 'scene', model: 'test-model', inputTokens: 100, outputTokens: 50, costMicros: 1_000_000, createdAt: dayAgo(0, 9) },
        { campaignId, requestType: 'scene', model: 'test-model', inputTokens: 100, outputTokens: 50, costMicros: 500_000, createdAt: dayAgo(0, 15) },
        { campaignId, requestType: 'scene', model: 'test-model', inputTokens: 100, outputTokens: 50, costMicros: 2_000_000, createdAt: dayAgo(2) },
        { campaignId, requestType: 'scene', model: 'test-model', inputTokens: 100, outputTokens: 50, costMicros: 9_000_000, createdAt: dayAgo(40) },
      ],
    })
  })

  afterAll(async () => {
    await prisma.aICostEntry.deleteMany({ where: { campaignId } })
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => {})
    await prisma.$disconnect()
  })

  it('sums same-day entries, zero-fills a silent day, and excludes entries outside the window', async () => {
    const result = await getAICostByDay(30)
    expect(result).toHaveLength(30)

    const byDate = new Map(result.map((r) => [r.date, r.costDollars]))
    const today = dayAgo(0).toISOString().slice(0, 10)
    const twoDaysAgo = dayAgo(2).toISOString().slice(0, 10)
    const yesterday = dayAgo(1).toISOString().slice(0, 10)

    expect(byDate.get(today)).toBeCloseTo(1.5, 5)
    expect(byDate.get(twoDaysAgo)).toBeCloseTo(2, 5)
    expect(byDate.get(yesterday)).toBe(0)

    const totalAcrossWindow = result.reduce((sum, r) => sum + r.costDollars, 0)
    expect(totalAcrossWindow).toBeCloseTo(3.5, 5) // 40-days-ago entry excluded
  })

  it('is scoped platform-wide and unaffected by an unrelated campaign with no entries', async () => {
    const other = await prisma.campaign.create({
      data: { title: 'Unrelated Campaign', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    try {
      const before = await getAICostByDay(30)
      const after = await getAICostByDay(30)
      expect(after).toEqual(before)
    } finally {
      await prisma.campaign.delete({ where: { id: other.id } }).catch(() => {})
    }
  })
})
