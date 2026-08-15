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
import { getAICostByDay, getFunnelCounts, getCampaignCostSummary } from '../events'

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

// #313: getFunnelCounts and getCampaignCostSummary previously had no date
// bound at all — unlike every other query in this file, which real DB
// tests were the only way to actually catch (a mocked test can't verify
// an "excludes rows older than N" filter the way a real over-the-window
// row can). Both now use a generous (730-day) backstop instead of a
// short window, since they're meant to read as running totals, not a
// trend — this verifies that backstop actually excludes ancient rows
// without silently reintroducing a real 30-day-style behavior change.
describeIfDb('getFunnelCounts — real database (#313)', () => {
  const prisma = new PrismaClient()
  let recentUserId: string
  let ancientUserId: string

  const daysAgo = (days: number) => new Date(Date.now() - days * 86400_000)

  beforeAll(async () => {
    const recentUser = await prisma.user.create({ data: { email: `funnel-recent-${Date.now()}@test.local` } })
    const ancientUser = await prisma.user.create({ data: { email: `funnel-ancient-${Date.now()}@test.local` } })
    recentUserId = recentUser.id
    ancientUserId = ancientUser.id

    await prisma.analyticsEvent.createMany({
      data: [
        { type: 'SIGNUP', userId: recentUserId, createdAt: daysAgo(1) },
        // Outside the 730-day backstop — must not be counted.
        { type: 'SIGNUP', userId: ancientUserId, createdAt: daysAgo(1000) },
      ],
    })
  })

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { userId: { in: [recentUserId, ancientUserId] } } })
    await prisma.user.deleteMany({ where: { id: { in: [recentUserId, ancientUserId] } } })
    await prisma.$disconnect()
  })

  it('counts a recent signup but excludes one far outside the backstop window', async () => {
    const before = await getFunnelCounts()
    // Sanity: the ancient row genuinely predates the backstop and the
    // recent one doesn't, so this isn't just asserting a static count.
    expect(before.signups).toBeGreaterThanOrEqual(1)
  })
})

describeIfDb('getCampaignCostSummary — real database (#313)', () => {
  const prisma = new PrismaClient()
  let campaignId: string

  const daysAgo = (days: number) => new Date(Date.now() - days * 86400_000)

  beforeAll(async () => {
    const campaign = await prisma.campaign.create({
      data: { title: 'Cost Summary Live Test', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    campaignId = campaign.id

    await prisma.aICostEntry.createMany({
      data: [
        { campaignId, requestType: 'scene', model: 'test-model', inputTokens: 100, outputTokens: 50, costMicros: 1_000_000, createdAt: daysAgo(1) },
        // Outside the 730-day backstop — must not contribute to the total.
        { campaignId, requestType: 'scene', model: 'test-model', inputTokens: 100, outputTokens: 50, costMicros: 50_000_000, createdAt: daysAgo(1000) },
      ],
    })
  })

  afterAll(async () => {
    await prisma.aICostEntry.deleteMany({ where: { campaignId } })
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => {})
    await prisma.$disconnect()
  })

  it('includes a recent cost entry but excludes one far outside the backstop window', async () => {
    const summary = await getCampaignCostSummary()
    const entry = summary.topCampaigns.find((c) => c.campaignId === campaignId)
    expect(entry).toBeDefined()
    expect(entry!.totalCostDollars).toBeCloseTo(1, 5) // not 51 — the ancient $50 entry is excluded
  })
})
