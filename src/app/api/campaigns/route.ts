// src/app/api/campaigns/route.ts
// Campaign management endpoints
// GET - List campaigns user belongs to
// POST - Create new campaign

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { CreateCampaignRequest, ErrorResponse } from '@/types/api'
import { CampaignRole } from '@prisma/client'

// GET /api/campaigns - List user's campaigns
export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request)

    // Get all campaigns where user is a member
    const memberships = await prisma.campaignMembership.findMany({
      where: { userId: user.userId },
      include: {
        campaign: {
          include: {
            createdBy: {
              select: { id: true, email: true }
            },
            _count: {
              select: { 
                characters: true,
                scenes: true
              }
            }
          }
        }
      }
    })

    const campaigns = memberships.map(m => ({
      ...m.campaign,
      userRole: m.role
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

    // Validate input
    if (!title || !description || !universe || !aiSystemPrompt || !initialWorldSeed) {
      return NextResponse.json<ErrorResponse>(
        { error: 'All fields are required' },
        { status: 400 }
      )
    }

    // Create campaign with WorldMeta and membership in a transaction
    const campaign = await prisma.$transaction(async (tx) => {
      // Create the campaign
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

      // Add creator as ADMIN member
      await tx.campaignMembership.create({
        data: {
          userId: user.userId,
          campaignId: newCampaign.id,
          role: CampaignRole.ADMIN
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
