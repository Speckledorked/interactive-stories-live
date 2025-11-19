// src/app/api/campaigns/[id]/characters/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'

interface CreateCharacterBody {
  name: string
  pronouns?: string
  description?: string
  stats?: any
  backstory?: string
  goals?: string
  currentLocation?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const body: CreateCharacterBody = await request.json()

    // Validate required fields
    if (!body.name) {
      return NextResponse.json(
        { error: 'Character name is required' },
        { status: 400 }
      )
    }

    // Check membership
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.id,
          campaignId,
        },
      },
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'You are not a member of this campaign' },
        { status: 403 }
      )
    }

    // Create character
    const character = await prisma.character.create({
      data: {
        campaignId,
        userId: user.id,
        name: body.name,
        pronouns: body.pronouns,
        description: body.description,
        stats: body.stats,
        backstory: body.backstory,
        goals: body.goals,
        currentLocation: body.currentLocation,
      },
    })

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

    // Check membership
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.id,
          campaignId,
        },
      },
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'You are not a member of this campaign' },
        { status: 403 }
      )
    }

    // Get characters
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
