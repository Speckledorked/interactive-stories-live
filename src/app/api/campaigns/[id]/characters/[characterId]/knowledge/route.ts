// src/app/api/campaigns/[id]/characters/[characterId]/knowledge/route.ts
//
// #520 — what this character knows, and how they came to know it.
//
// Reads EventWitness, which tick/informationTick.ts has been filling since
// #101 and which no route has ever served. Three things make this a
// separate route rather than a field on the character sheet:
//
//  1. **It is owner-scoped, and the sheet is not.** Any member may view
//     any character (see the GET in ../route.ts). Knowledge is different:
//     knowing what another player's character has heard is a real leak
//     between players, and half the value of information latency is not
//     knowing what the rest of the table knows.
//  2. **It is unbounded in a way a sheet is not.** A months-old character
//     has hundreds of witness rows; capping lives in
//     characterKnowledge.ts rather than bloating every sheet fetch.
//  3. **It needs the WorldEvent fog pass**, which is four extra id
//     queries nothing else on the sheet wants to pay for.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { isCampaignAdmin } from '@/lib/api/visibility'
import { buildWorldEventFog } from '@/lib/api/worldEventFog'
import {
  buildCharacterKnowledge,
  MAX_KNOWN_EVENTS_PER_SOURCE,
  type KnowledgeRow,
} from '@/lib/game/characterKnowledge'

/**
 * How many rows to pull before filtering.
 *
 * Fog and phrasing both drop rows AFTER the query, so taking exactly the
 * display cap would under-fill the lists whenever anything got dropped.
 * Bounded well above the cap instead — enough headroom that a normal
 * character's lists fill, while an ancient campaign still cannot ship an
 * unbounded read.
 */
const WITNESS_SCAN_LIMIT = MAX_KNOWN_EVENTS_PER_SOURCE * 10

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; characterId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, characterId } = params

    const membership = await getCampaignMembership(user.userId, campaignId)
    if (!membership) {
      return NextResponse.json(
        { error: 'You are not a member of this campaign' },
        { status: 403 }
      )
    }

    const character = await prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true, userId: true, campaignId: true },
    })

    if (!character || character.campaignId !== campaignId) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Owner or the campaign's admin. The admin exception is not a
    // convenience: they run the world, already see through the fog
    // everywhere else, and have the full tick log at /world-events — a
    // character's own hearsay is strictly less than they already hold.
    const isOwner = character.userId === user.userId
    if (!isOwner && !isCampaignAdmin(membership.role)) {
      return NextResponse.json(
        { error: "You can only read your own character's knowledge" },
        { status: 403 }
      )
    }

    // Independent of the row fetch, so they overlap rather than queue.
    const [isVisible, witnessRows] = await Promise.all([
      buildWorldEventFog(campaignId, membership.role),
      prisma.eventWitness.findMany({
        where: { campaignId, characterId },
        orderBy: { turnNumber: 'desc' },
        take: WITNESS_SCAN_LIMIT,
        select: {
          grade: true,
          turnNumber: true,
          distorted: true,
          worldEvent: {
            select: {
              type: true,
              targetType: true,
              targetId: true,
              targetName: true,
              previousValue: true,
              newValue: true,
              // `reason` is deliberately absent. It is the simulation's
              // private account of why it acted and can reference a
              // hidden faction's scheme or an undiscovered NPC's plan —
              // the reason ../../world-events is admin-only. Not selected
              // at all, so it cannot reach a serializer by accident.
            },
          },
        },
      }),
    ])

    const rows: KnowledgeRow[] = witnessRows
      .filter((row) =>
        isVisible({ targetType: row.worldEvent.targetType, targetId: row.worldEvent.targetId })
      )
      .map((row) => ({
        grade: row.grade,
        turnNumber: row.turnNumber,
        distorted: row.distorted,
        event: {
          type: row.worldEvent.type,
          targetName: row.worldEvent.targetName,
          previousValue: row.worldEvent.previousValue,
          newValue: row.worldEvent.newValue,
        },
      }))

    return NextResponse.json(buildCharacterKnowledge(rows))
  } catch (error) {
    console.error('Get character knowledge error:', error)
    return NextResponse.json(
      { error: 'Failed to load what this character knows' },
      { status: 500 }
    )
  }
}
