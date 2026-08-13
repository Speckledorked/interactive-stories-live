// src/lib/analytics/events.ts
// #12 alpha instrumentation — funnel/retention event recording + the
// query helpers behind the admin analytics dashboard
// (/api/admin/analytics, src/app/admin/analytics).
//
// Five events cover the whole activation funnel: SIGNUP -> CAMPAIGN_CREATED
// -> CHARACTER_CREATED -> SCENE_STARTED -> ACTION_SUBMITTED. The last one
// doubles as the retention/DAU signal — it's the most direct "did this
// person actually play today" moment in the pipeline, firing every time
// anyone submits a turn.

import { prisma } from '@/lib/prisma'
import { AnalyticsEventType } from '@prisma/client'

/**
 * Best-effort event write. Never throws — instrumentation must not be
 * able to break the request it's attached to. Call this fire-and-forget
 * style is fine too (it swallows its own errors), but callers still await
 * it here so a genuinely down DB doesn't silently orphan events mid-flight.
 */
export async function recordEvent(
  type: AnalyticsEventType,
  opts: { userId?: string; campaignId?: string; metadata?: Record<string, unknown> } = {}
): Promise<void> {
  try {
    await prisma.analyticsEvent.create({
      data: {
        type,
        userId: opts.userId,
        campaignId: opts.campaignId,
        metadata: opts.metadata as object | undefined,
      },
    })
  } catch (error) {
    console.error(`Failed to record analytics event ${type} (non-critical):`, error)
  }
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

export interface FunnelCounts {
  signups: number
  campaignsCreated: number
  charactersCreated: number
  scenesStarted: number
  actionsSubmitted: number
}

const FUNNEL_TYPES: AnalyticsEventType[] = [
  'SIGNUP', 'CAMPAIGN_CREATED', 'CHARACTER_CREATED', 'SCENE_STARTED', 'ACTION_SUBMITTED',
]

/** Distinct users who have logged at least one event of each funnel stage. */
export async function getFunnelCounts(): Promise<FunnelCounts> {
  const counts = await Promise.all(
    FUNNEL_TYPES.map(type =>
      prisma.analyticsEvent.findMany({
        where: { type, userId: { not: null } },
        distinct: ['userId'],
        select: { userId: true },
      })
    )
  )
  const [signups, campaignsCreated, charactersCreated, scenesStarted, actionsSubmitted] =
    counts.map(rows => rows.length)
  return { signups, campaignsCreated, charactersCreated, scenesStarted, actionsSubmitted }
}

export interface DailyCount {
  date: string // YYYY-MM-DD (UTC)
  count: number
}

/** Signups per UTC day for the last N days, zero-filled for silent days. */
export async function getSignupsByDay(days = 30): Promise<DailyCount[]> {
  const since = new Date(Date.now() - days * 86400_000)
  const rows = await prisma.analyticsEvent.findMany({
    where: { type: 'SIGNUP', createdAt: { gte: since } },
    select: { createdAt: true },
  })
  const byDay = new Map<string, number>()
  for (const row of rows) {
    const key = row.createdAt.toISOString().slice(0, 10)
    byDay.set(key, (byDay.get(key) ?? 0) + 1)
  }
  const result: DailyCount[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10)
    result.push({ date: d, count: byDay.get(d) ?? 0 })
  }
  return result
}

// ---------------------------------------------------------------------------
// Retention (pure math, DB orchestration around it)
// ---------------------------------------------------------------------------

export interface UserActivity {
  userId: string
  signupAt: Date
  activityDates: Date[] // ACTION_SUBMITTED timestamps for this user
}

const MS_PER_DAY = 86_400_000

/**
 * Pure: did this user have activity on exactly calendar-day N after their
 * own signup (the standard "DN retention" definition — returned on that
 * specific day, not "at some point within N days")?
 */
export function isRetainedOnDay(signupAt: Date, activityDates: Date[], dayN: number): boolean {
  const dayStart = signupAt.getTime() + dayN * MS_PER_DAY
  const dayEnd = dayStart + MS_PER_DAY
  return activityDates.some(d => d.getTime() >= dayStart && d.getTime() < dayEnd)
}

/** Pure: how many of these users were retained on day N. */
export function countRetainedOnDay(users: UserActivity[], dayN: number): number {
  return users.filter(u => isRetainedOnDay(u.signupAt, u.activityDates, dayN)).length
}

export interface CohortMetric {
  retained: number
  eligible: boolean // has enough time passed to measure this window at all
}

export interface CohortRetention {
  weekStart: string // ISO date, UTC Monday
  cohortSize: number
  d1: CohortMetric
  d7: CohortMetric
  d28: CohortMetric
}

/**
 * Pure: build one cohort's retention row. `nowMs` and `weekStart` decide
 * eligibility (a week-old cohort can't have a real D28 number yet — that's
 * reported as ineligible/pending rather than a misleading 0%).
 */
export function computeCohortRetention(
  weekStart: Date,
  users: UserActivity[],
  nowMs: number
): CohortRetention {
  const eligible = (dayN: number) => weekStart.getTime() + (dayN + 1) * MS_PER_DAY <= nowMs
  return {
    weekStart: weekStart.toISOString().slice(0, 10),
    cohortSize: users.length,
    d1: { retained: countRetainedOnDay(users, 1), eligible: eligible(1) },
    d7: { retained: countRetainedOnDay(users, 7), eligible: eligible(7) },
    d28: { retained: countRetainedOnDay(users, 28), eligible: eligible(28) },
  }
}

function utcMonday(d: Date): Date {
  const day = d.getUTCDay() // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day // days back to Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  monday.setUTCDate(monday.getUTCDate() + diff)
  return monday
}

/**
 * Weekly signup cohorts with D1/D7/D28 retention, most recent week last.
 * Bounds both queries to weeksBack+~5 weeks of history so this stays cheap
 * at alpha-playtest scale without needing raw SQL.
 */
export async function getRetentionByCohortWeek(weeksBack = 8): Promise<CohortRetention[]> {
  const now = new Date()
  const lookbackStart = utcMonday(new Date(now.getTime() - weeksBack * 7 * MS_PER_DAY))

  const [signups, actions] = await Promise.all([
    prisma.analyticsEvent.findMany({
      where: { type: 'SIGNUP', createdAt: { gte: lookbackStart }, userId: { not: null } },
      select: { userId: true, createdAt: true },
    }),
    // D28 needs activity up to 29 days after a signup near the lookback
    // edge — pad the activity window accordingly.
    prisma.analyticsEvent.findMany({
      where: { type: 'ACTION_SUBMITTED', createdAt: { gte: lookbackStart }, userId: { not: null } },
      select: { userId: true, createdAt: true },
    }),
  ])

  const activityByUser = new Map<string, Date[]>()
  for (const row of actions) {
    if (!row.userId) continue
    const list = activityByUser.get(row.userId) ?? []
    list.push(row.createdAt)
    activityByUser.set(row.userId, list)
  }

  const cohorts = new Map<string, UserActivity[]>()
  for (const row of signups) {
    if (!row.userId) continue
    const weekKey = utcMonday(row.createdAt).toISOString()
    const list = cohorts.get(weekKey) ?? []
    list.push({ userId: row.userId, signupAt: row.createdAt, activityDates: activityByUser.get(row.userId) ?? [] })
    cohorts.set(weekKey, list)
  }

  return Array.from(cohorts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, users]) => computeCohortRetention(new Date(weekKey), users, now.getTime()))
}

// ---------------------------------------------------------------------------
// User/campaign listing (#99) — metadata-only, no schema change

export interface UserCampaignListingEntry {
  userId: string
  email: string
  name: string | null
  createdAt: Date
  campaigns: Array<{ id: string; title: string; createdAt: Date }>
}

const USER_CAMPAIGN_LISTING_LIMIT = 100

/**
 * A site-owner-only, metadata-only listing of users and the campaigns
 * they've created. No new schema — there's no Campaign.creatorId, so
 * "created" is read off the existing CampaignMembership.role === 'ADMIN'
 * relation, the same signal admin-only campaign features already gate on
 * everywhere else in this app. Most-recently-joined users first, capped
 * so this stays a glance-able list rather than a full export.
 */
export async function getUserCampaignListing(): Promise<UserCampaignListingEntry[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: USER_CAMPAIGN_LISTING_LIMIT,
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      campaignMemberships: {
        where: { role: 'ADMIN' },
        select: { campaign: { select: { id: true, title: true, createdAt: true } } },
      },
    },
  })

  return users.map((u) => ({
    userId: u.id,
    email: u.email,
    name: u.name,
    createdAt: u.createdAt,
    campaigns: u.campaignMemberships.map((m) => m.campaign),
  }))
}

// ---------------------------------------------------------------------------
// AI cost by campaign — every AI call already writes a real AICostEntry row
// (see recordAICost/AICostTracker in lib/ai/cost-tracker.ts); nothing had
// ever aggregated it for a glance view before this.

export interface CampaignCostEntry {
  campaignId: string
  title: string
  totalCostDollars: number
  totalPaidDollars: number
  requestCount: number
}

export interface CampaignCostSummary {
  totalCostDollars: number
  totalPaidDollars: number
  totalRequests: number
  topCampaigns: CampaignCostEntry[]
}

const CAMPAIGN_COST_TOP_N = 20

interface CampaignPaidRow {
  campaignId: string
  paidDollars: number
}

/**
 * Platform-wide AI spend ("cost") vs. what's actually been billed and
 * collected from players ("paid"), plus the highest-cost campaigns. Two
 * independent sources, not one: AICostEntry is our real expense (raw AI
 * call cost); Transaction is real revenue — scene-resolution billing
 * (resolutionBilling.ts's chargeForSceneResolution) deducts a metered,
 * marked-up charge from each participant's balance and records it as a
 * DEBIT Transaction. Transaction has no campaignId column (it's per-user,
 * not per-campaign) — chargeForSceneResolution stashes campaignId in
 * metadata instead, so paid totals need a raw JSON-path groupBy that
 * Prisma's query builder can't express. Neither total scopes to
 * admin-owned campaigns the way getUserCampaignListing does — cost and
 * revenue matter regardless of who administers a campaign.
 */
export async function getCampaignCostSummary(): Promise<CampaignCostSummary> {
  const [grouped, paidRows] = await Promise.all([
    prisma.aICostEntry.groupBy({
      by: ['campaignId'],
      _sum: { costMicros: true },
      _count: { _all: true },
    }),
    prisma.$queryRaw<CampaignPaidRow[]>`
      SELECT metadata->>'campaignId' AS "campaignId", (SUM(-amount)::numeric / 100)::float8 AS "paidDollars"
      FROM transactions
      WHERE type = 'DEBIT' AND metadata->>'campaignId' IS NOT NULL
      GROUP BY metadata->>'campaignId'
    `,
  ])

  const paidDollarsByCampaign = new Map(paidRows.map((r) => [r.campaignId, r.paidDollars]))

  const totalCostMicros = grouped.reduce((sum, g) => sum + (g._sum.costMicros ?? 0), 0)
  const totalRequests = grouped.reduce((sum, g) => sum + g._count._all, 0)
  const totalPaidDollars = paidRows.reduce((sum, r) => sum + r.paidDollars, 0)

  const top = [...grouped]
    .sort((a, b) => (b._sum.costMicros ?? 0) - (a._sum.costMicros ?? 0))
    .slice(0, CAMPAIGN_COST_TOP_N)

  const campaigns = await prisma.campaign.findMany({
    where: { id: { in: top.map((g) => g.campaignId) } },
    select: { id: true, title: true },
  })
  const titleById = new Map(campaigns.map((c) => [c.id, c.title]))

  return {
    totalCostDollars: totalCostMicros / 1_000_000,
    totalPaidDollars,
    totalRequests,
    topCampaigns: top.map((g) => ({
      campaignId: g.campaignId,
      title: titleById.get(g.campaignId) ?? '(deleted campaign)',
      totalCostDollars: (g._sum.costMicros ?? 0) / 1_000_000,
      totalPaidDollars: paidDollarsByCampaign.get(g.campaignId) ?? 0,
      requestCount: g._count._all,
    })),
  }
}

export interface DailyCost {
  date: string // YYYY-MM-DD (UTC)
  costDollars: number
}

interface DailyCostRow {
  date: string
  costMicros: bigint | number
}

/**
 * #260: the flat topCampaigns list above answers "who's expensive" but
 * not "is spend trending up" — this buckets the same AICostEntry rows by
 * UTC day, platform-wide (not per-campaign — the dashboard already scopes
 * cost/revenue platform-wide elsewhere, see getCampaignCostSummary),
 * zero-filled for silent days like getSignupsByDay.
 */
export async function getAICostByDay(days = 30): Promise<DailyCost[]> {
  const since = new Date(Date.now() - days * 86400_000)
  const rows = await prisma.$queryRaw<DailyCostRow[]>`
    SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
           SUM("costMicros") AS "costMicros"
    FROM "AICostEntry"
    WHERE "createdAt" >= ${since}
    GROUP BY date
  `
  const byDay = new Map(rows.map((r) => [r.date, Number(r.costMicros) / 1_000_000]))
  const result: DailyCost[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10)
    result.push({ date: d, costDollars: byDay.get(d) ?? 0 })
  }
  return result
}
