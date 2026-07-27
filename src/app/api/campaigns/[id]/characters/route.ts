// src/app/api/campaigns/[id]/characters/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { validateStats } from '@/lib/game/advancement'
import { isWorldSeeding, SEEDING_MESSAGE } from '@/lib/lore/seedingGate'
import { recordEvent } from '@/lib/analytics/events'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { createCharacter, type CreateCharacterBody } from '@/lib/game/characterCreation'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const body: CreateCharacterBody = await request.json()

    if (!body.name) {
      return NextResponse.json(
        { error: 'Character name is required' },
        { status: 400 }
      )
    }

    // Play lock: no characters until a creation-time canon import has
    // finished reseeding the world — a character created now would freeze
    // the provisional world in place (see lib/lore/seedingGate.ts).
    if (await isWorldSeeding(campaignId)) {
      return NextResponse.json({ error: SEEDING_MESSAGE, worldSeeding: true }, { status: 409 })
    }

    // Validate stats if provided
    if (body.stats) {
      const validation = validateStats(body.stats as Record<string, number>)
      if (!validation.valid) {
        return NextResponse.json(
          { error: `Invalid stats: ${validation.error}` },
          { status: 400 }
        )
      }
    }

    const membership = await getCampaignMembership(user.userId, campaignId)

    if (!membership) {
      return NextResponse.json(
        { error: 'You are not a member of this campaign' },
        { status: 403 }
      )
    }

    const character = await createCharacter(campaignId, user.userId, body)

    await recordEvent('CHARACTER_CREATED', { userId: user.userId, campaignId })

    return NextResponse.json({ character })
  } catch (error) {
    console.error('Create character error:', error)
    return NextResponse.json(
      { error: 'Failed to create character' },
      { status: 500 }
    )
  }
}

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
      return NextResponse.json(
        { error: 'You are not a member of this campaign' },
        { status: 403 }
      )
    }

    const characters = await prisma.character.findMany({
      where: {
        campaignId,
        isAlive: true,
      },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    return NextResponse.json({ characters })
  } catch (error) {
    console.error('Get characters error:', error)
    return NextResponse.json(
      { error: 'Failed to get characters' },
      { status: 500 }
    )
  }
}
