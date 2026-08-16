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
import { applyWhatIf, STAT_BAND, type WhatIfSpec } from '@/lib/api/whatIf'

/**
 * #427: what an admin may perturb on a clock preview.
 *
 * `tension` is the interesting one — it is the ONLY input to
 * explainClockAdvancement that a GM cannot set directly anywhere in the
 * app, because it is derived from live state (clocks near firing, wars,
 * party harm). "Would this clock move faster if the campaign were tenser?"
 * had no way to be asked before this.
 */
const CLOCK_WHAT_IF: WhatIfSpec = { tension: STAT_BAND, currentTicks: { min: 0, max: 100 } }
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
    const actualTension = worldMeta.tension ?? TENSION_BASELINE

    // #427: overlaid before the projection, so the reasoning explains the
    // hypothetical rather than blending it with live state.
    const whatIf = applyWhatIf(
      { ...clock, tension: actualTension },
      request.nextUrl.searchParams,
      CLOCK_WHAT_IF
    )
    const projected = whatIf.snapshot

    const { advanceAmount, reasoning } = explainClockAdvancement(
      projected,
      factionById,
      worldMeta.currentTurnNumber,
      projected.tension,
      clockSpeedMultiplier
    )

    return NextResponse.json({
      clock: { id: clock.id, name: clock.name, currentTicks: projected.currentTicks, maxTicks: clock.maxTicks },
      turnNumber: worldMeta.currentTurnNumber,
      projectedAdvance: advanceAmount,
      projectedTicks: Math.min(projected.currentTicks + advanceAmount, clock.maxTicks),
      reasoning,
      whatIf: {
        overridden: whatIf.overridden,
        rejected: whatIf.rejected,
        actual: { tension: actualTension, currentTicks: clock.currentTicks },
      },
    })
  } catch (error) {
    console.error('Clock reasoning preview error:', error)
    return NextResponse.json({ error: 'Failed to preview clock reasoning' }, { status: 500 })
  }
}
