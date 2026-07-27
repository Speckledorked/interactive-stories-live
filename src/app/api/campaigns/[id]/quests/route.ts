// src/app/api/campaigns/[id]/quests/route.ts
// A dedicated, member-facing quest log. Quest rows have existed since the
// AI GM contract was built (world_updates.quest_changes -> worldUpdaters/
// quests.ts) and are read into every prompt, but were never surfaced
// through their own API/UI - the only place a player could see one was
// buried in the generic Wiki page's QUEST tab, where status/objective/
// reward get flattened into one prose blob instead of staying structured
// fields a real quest-log view can group and format.

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getCampaignMembership } from '@/lib/db/campaignAccess'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Called-out fix, not a silent behavior change: previously hand-rolled
    // token parsing here bypassed session revocation (isTokenRevoked) —
    // a token invalidated via "log out everywhere" still worked on this
    // route. getUser() applies the same revocation check every other
    // route already gets. It also collapses "no token" and "bad token"
    // into one 'Unauthorized' message instead of two, matching the
    // convention everywhere else in the API.
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id

    const membership = await getCampaignMembership(user.userId, campaignId)

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const quests = await prisma.quest.findMany({
      where: { campaignId },
      orderBy: { updatedAt: 'desc' }
    })

    return NextResponse.json({ quests })
  } catch (error) {
    console.error('Error fetching quests:', error)
    return NextResponse.json({ error: 'Failed to fetch quests' }, { status: 500 })
  }
}
