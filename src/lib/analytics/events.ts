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
