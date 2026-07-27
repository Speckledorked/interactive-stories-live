// src/app/api/campaigns/[id]/logs/calendar/route.ts
// "Which days in this in-fiction month have entries" — feeds the Story
// Log's month-grid calendar view. Distinct from GET .../logs (the flat,
// all-entries list): this is a per-month marker lookup, keyed by the
// campaign's own generated calendar (see lib/game/calendar.ts), not turn
// number. Never returns summaryGM — same redaction discipline as
// rumors/route.ts, since a rumor marker here is built from the same
// isOffscreen/PUBLIC-or-MIXED TimelineEvent rows that route reads.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { handleRouteError } from '@/lib/api/errors'
import { DEFAULT_CALENDAR, formatInGameDate, dayNumberRangeForMonth, type GeneratedCalendar } from '@/lib/game/calendar'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const membership = await getCampaignMembership(user.userId, campaignId)
    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { calendarConfig: true, worldMeta: { select: { totalElapsedGameHours: true } } },
    })
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    // A campaign whose calendar hasn't been backfilled yet (calendarConfig
    // still null) shows the same DEFAULT_CALENDAR grid the next scene
    // resolution would lazily generate a real one from — never blocks on
    // generating one just to render this view.
    const calendar = (campaign.calendarConfig as GeneratedCalendar | null) || DEFAULT_CALENDAR
    const current = formatInGameDate(campaign.worldMeta?.totalElapsedGameHours || 0, calendar)

    const { searchParams } = new URL(request.url)
    const year = searchParams.has('year') ? parseInt(searchParams.get('year')!, 10) : current.year
    const monthIndex = searchParams.has('month') ? parseInt(searchParams.get('month')!, 10) : current.monthIndex

    if (!Number.isFinite(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex >= calendar.months.length) {
      return NextResponse.json({ error: 'Invalid year or month' }, { status: 400 })
    }

    const { startDayNumber, endDayNumberExclusive } = dayNumberRangeForMonth(calendar, year, monthIndex)
    const firstWeekdayIndex = calendar.weekdayNames.indexOf(formatInGameDate(startDayNumber * 24, calendar).weekdayName)

    const [logDays, rumorDays] = await Promise.all([
      prisma.campaignLog.groupBy({
        by: ['inGameDayNumber'],
        where: { campaignId, inGameDayNumber: { gte: startDayNumber, lt: endDayNumberExclusive } },
      }),
      prisma.timelineEvent.groupBy({
        by: ['inGameDayNumber'],
        where: {
          campaignId,
          isOffscreen: true,
          visibility: { in: ['PUBLIC', 'MIXED'] },
          summaryPublic: { not: null },
          inGameDayNumber: { gte: startDayNumber, lt: endDayNumberExclusive },
        },
      }),
    ])

    const markers: Record<number, { hasLogs: boolean; hasRumors: boolean }> = {}
    const ensureDay = (dayOfMonth: number) => {
      if (!markers[dayOfMonth]) markers[dayOfMonth] = { hasLogs: false, hasRumors: false }
      return markers[dayOfMonth]
    }
    for (const row of logDays) {
      if (row.inGameDayNumber == null) continue
      ensureDay(row.inGameDayNumber - startDayNumber + 1).hasLogs = true
    }
    for (const row of rumorDays) {
      if (row.inGameDayNumber == null) continue
      ensureDay(row.inGameDayNumber - startDayNumber + 1).hasRumors = true
    }

    return NextResponse.json({
      year,
      month: monthIndex,
      monthName: calendar.months[monthIndex].name,
      daysInMonth: calendar.months[monthIndex].days,
      weekdayNames: calendar.weekdayNames,
      firstWeekdayIndex: firstWeekdayIndex >= 0 ? firstWeekdayIndex : 0,
      monthsInYear: calendar.months.length,
      startDayNumber,
      isCurrentMonth: year === current.year && monthIndex === current.monthIndex,
      currentDayOfMonth: current.dayOfMonth,
      markers,
    })
  } catch (error) {
    return handleRouteError(error, 'Get logs calendar error', 'Failed to get calendar')
  }
}
