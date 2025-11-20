// src/app/api/campaigns/[id]/join/route.ts
// Join a campaign as a player
// POST /api/campaigns/:id/join

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id

    // Check if campaign exists
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId }
    })

    if (!campaign) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Campaign not found' },
        { status: 404 }
      )
    }

    // Check if already a member
    const existingMembership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId
        }
      }
    })

    if (existingMembership) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Already a member of this campaign' },
        { status: 409 }
      )
    }

    // Create membership as PLAYER
    const membership = await prisma.campaignMembership.create({
      data: {
        userId: user.userId,
        campaignId,
        role: CampaignRole.PLAYER
      }
    })

    return NextResponse.json({ 
      message: 'Successfully joined campaign',
      membership 
    }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.error('Join campaign error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
