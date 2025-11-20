// src/app/api/campaigns/route.ts
// Campaign management endpoints
// GET - List campaigns user belongs to
// POST - Create new campaign

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { CreateCampaignRequest, ErrorResponse } from '@/types/api'

// GET /api/campaigns - List user's campaigns
export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request)

    // Find all campaign memberships for the user
    const memberships = await prisma.campaignMembership.findMany({
      where: {
        userId: user.userId
      },
      include: {
        campaign: true
      },
      orderBy: {
        joinedAt: 'desc'
      }
    })

    // Map to campaigns with role info
    const campaigns = memberships.map((m) => ({
      ...m.campaign,
      role: m.role
    }))

    return NextResponse.json({ campaigns })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.error('Get campaigns error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/campaigns - Create new campaign
export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request)
    const body: CreateCampaignRequest = await request.json()
    const { title, description, universe, aiSystemPrompt, initialWorldSeed } = body

    if (!title) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Title is required' },
        { status: 400 }
      )
    }

    // Create campaign and membership in a transaction
    const campaign = await prisma.$transaction(async (tx) => {
      // Create campaign
      const newCampaign = await tx.campaign.create({
        data: {
          title,
          description,
          universe,
          aiSystemPrompt,
          initialWorldSeed,
          createdByUserId: user.userId
        }
      })

      // Create WorldMeta for this campaign
      await tx.worldMeta.create({
        data: {
          campaignId: newCampaign.id,
          currentTurnNumber: 0,
          currentInGameDate: 'Day 1',
          gmStyleNotes: {},
          otherMeta: {}
        }
      })

      // Make current user an admin member of the campaign
      await tx.campaignMembership.create({
        data: {
          userId: user.userId,
          campaignId: newCampaign.id,
          role: 'admin' // string column: "admin" | "player"
        }
      })

      return newCampaign
    })

    return NextResponse.json({ campaign }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.error('Create campaign error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
