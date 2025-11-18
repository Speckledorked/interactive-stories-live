// src/app/api/campaigns/[id]/characters/route.ts
// Character management for a campaign
// POST - Create a new character

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { CreateCharacterRequest, ErrorResponse } from '@/types/api'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id
    const body: CreateCharacterRequest = await request.json()

    const { name, concept, stats, conditions, currentLocation } = body

    // Validate input
    if (!name || !concept) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Name and concept are required' },
        { status: 400 }
      )
    }

    // Check if user is a member of this campaign
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId
        }
      }
    })

    if (!membership) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Not a member of this campaign' },
        { status: 403 }
      )
    }

    // Create character
    const character = await prisma.character.create({
      data: {
        campaignId,
        userId: user.userId,
        name,
        concept,
        stats: stats || {},
        conditions: conditions || [],
        currentLocation: currentLocation || 'Unknown',
        isActive: true
      }
    })

    return NextResponse.json({ character }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.error('Create character error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
