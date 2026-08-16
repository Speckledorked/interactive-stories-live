// src/app/api/campaigns/[id]/locations/[locationId]/reasoning/route.ts
// #126 — "show your reasoning" for the Locations admin tab, extending #94's
// pattern to a third entity type. Read-only: loads this location's real
// current state, checks for the same ESCALATING-war-contesting-it signal
// tickLocationCondition (locationConditionTick.ts) reads for real, then
// calls the same pure explainConditionDrift a real tick would. Nothing
// here writes anything or advances the turn.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { explainConditionDrift, deriveConditionTags } from '@/lib/game/tick/locationConditionTick'
import { applyWhatIf, STAT_BAND, type WhatIfSpec } from '@/lib/api/whatIf'

/** #427: the one stat explainConditionDrift actually reads. */
const LOCATION_WHAT_IF: WhatIfSpec = { conditionScore: STAT_BAND }

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; locationId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, locationId } = params

    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can preview location reasoning')
    if ('response' in adminCheck) return adminCheck.response

    const location = await prisma.location.findFirst({
      where: { id: locationId, campaignId },
      select: { id: true, name: true, conditionScore: true, isContested: true },
    })

    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // Same "at war" signal tickLocationCondition reads for real: is this
    // location the contested prize of a currently ESCALATING war.
    const warContestingThisLocation = await prisma.war.findFirst({
      where: { campaignId, status: 'ESCALATING', contestedLocationId: locationId },
      select: { id: true },
    })
    const warPresent = Boolean(warContestingThisLocation)

    // #427: overlaid before the projection runs, so the drift explained is
    // the drift of the hypothetical rather than a blend of the two.
    const whatIf = applyWhatIf(location, request.nextUrl.searchParams, LOCATION_WHAT_IF)
    const projected = whatIf.snapshot

    const { nextConditionScore, reasoning } = explainConditionDrift(projected, warPresent, projected.isContested)

    return NextResponse.json({
      location: { id: location.id, name: location.name },
      currentConditionScore: projected.conditionScore,
      projectedConditionScore: nextConditionScore,
      currentTags: deriveConditionTags(projected.conditionScore, projected.isContested),
      projectedTags: deriveConditionTags(nextConditionScore, projected.isContested),
      reasoning,
      whatIf: {
        overridden: whatIf.overridden,
        rejected: whatIf.rejected,
        actual: { conditionScore: location.conditionScore },
      },
    })
  } catch (error) {
    console.error('Location reasoning preview error:', error)
    return NextResponse.json({ error: 'Failed to preview location reasoning' }, { status: 500 })
  }
}
