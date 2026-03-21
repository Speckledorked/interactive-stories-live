// src/app/api/campaigns/[id]/characters/[characterId]/stats/route.ts
// GET /api/campaigns/:id/characters/:characterId/stats
// Returns the CharacterStats shape expected by PlayerDashboard

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; characterId: string } }
) {
  try {
    const user = requireAuth(request)
    const { id: campaignId, characterId } = params

    const membership = await prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId: user.userId, campaignId } }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const character = await prisma.character.findUnique({
      where: { id: characterId },
      include: {
        playerActions: {
          where: { status: 'resolved' },
          select: { id: true }
        }
      }
    })

    if (!character || character.campaignId !== campaignId) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Count distinct scenes the character participated in
    const scenesCompleted = await prisma.playerAction.groupBy({
      by: ['sceneId'],
      where: { characterId, status: 'resolved' }
    })

    const conditions = (character.conditions as any)?.conditions ?? []

    return NextResponse.json({
      name: character.name,
      pronouns: character.pronouns ?? '',
      harm: (character.harm as number) ?? 0,
      experience: character.experience ?? 0,
      conditions,
      stats: character.stats ?? {},
      perks: (character.perks as any[]) ?? [],
      recentActions: character.playerActions.length,
      sessionsPlayed: scenesCompleted.length,
      scenesCompleted: scenesCompleted.length
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Character stats error:', error)
    return NextResponse.json({ error: 'Failed to fetch character stats' }, { status: 500 })
  }
}
