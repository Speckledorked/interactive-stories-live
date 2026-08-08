// src/app/api/campaigns/[id]/clocks/[clockId]/reasoning/route.ts
// #126 — "show your reasoning" for the Clocks admin tab, extending #94's
// pattern to a fourth entity type. Read-only: loads this clock's real
// linked faction(s), the campaign's current tension/season (both already
// persisted by the real world turn — read, never recomputed/rewritten
// here, since a preview must never mutate state), then calls the same
// pure explainClockAdvancement a real turn would. Nothing here writes
// anything or advances the turn.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { explainClockAdvancement, FactionForClockAdvancement } from '@/lib/game/tick/clockTick'
import { TENSION_BASELINE } from '@/lib/game/tick/tension'
import { SEASON_MODIFIERS } from '@/lib/game/tick/seasonTick'
import { GeneratedCalendar, deriveSeason } from '@/lib/game/calendar'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; clockId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, clockId } = params

    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can preview clock reasoning')
    if ('response' in adminCheck) return adminCheck.response

    const [clock, worldMeta] = await Promise.all([
      prisma.clock.findFirst({
        where: { id: clockId, campaignId },
        select: {
          id: true, name: true, category: true, currentTicks: true, maxTicks: true,
          sourceFactionId: true, relatedFactionId: true, participantNpcIds: true,
        },
      }),
      prisma.worldMeta.findUnique({
        where: { campaignId },
        select: {
          currentTurnNumber: true, tension: true, totalElapsedGameHours: true,
          campaign: { select: { calendarConfig: true } },
        },
      }),
    ])

    if (!clock) {
      return NextResponse.json({ error: 'Clock not found' }, { status: 404 })
    }
    if (!worldMeta) {
      return NextResponse.json({ error: 'Campaign has no world state yet' }, { status: 404 })
    }

    const factionIds = [clock.sourceFactionId, clock.relatedFactionId].filter((id): id is string => Boolean(id))
    const factions = factionIds.length > 0
      ? await prisma.faction.findMany({
          where: { id: { in: factionIds } },
          select: { id: true, resources: true, military: true, stability: true, isActive: true },
        })
      : []
    const factionById = new Map<string, FactionForClockAdvancement>(factions.map((f) => [f.id, f]))

    const calendar = worldMeta.campaign?.calendarConfig
      ? (worldMeta.campaign.calendarConfig as unknown as GeneratedCalendar)
      : null
    const season = deriveSeason(worldMeta.totalElapsedGameHours ?? 0, calendar)
    const clockSpeedMultiplier = SEASON_MODIFIERS[season].clockSpeedMultiplier
    const tension = worldMeta.tension ?? TENSION_BASELINE

    const { advanceAmount, reasoning } = explainClockAdvancement(
      clock,
      factionById,
      worldMeta.currentTurnNumber,
      tension,
      clockSpeedMultiplier
    )

    return NextResponse.json({
      clock: { id: clock.id, name: clock.name, currentTicks: clock.currentTicks, maxTicks: clock.maxTicks },
      turnNumber: worldMeta.currentTurnNumber,
      projectedAdvance: advanceAmount,
      projectedTicks: Math.min(clock.currentTicks + advanceAmount, clock.maxTicks),
      reasoning,
    })
  } catch (error) {
    console.error('Clock reasoning preview error:', error)
    return NextResponse.json({ error: 'Failed to preview clock reasoning' }, { status: 500 })
  }
}
