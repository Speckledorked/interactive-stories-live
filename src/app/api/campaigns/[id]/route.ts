// src/app/api/campaigns/[id]/route.ts
// Get specific campaign details
// GET /api/campaigns/:id

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id

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

    // Get campaign with all related data
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        worldMeta: true,
        characters: {
          include: {
            user: {
              select: { id: true, email: true }
            }
          }
        },
        npcs: true,
        factions: true,
        clocks: {
          where: {
            OR: [
              { isHidden: false },
              membership.role === 'ADMIN' ? { isHidden: true } : {}
            ]
          }
        },
        timelineEvents: {
          where: {
            OR: [
              { visibility: 'PUBLIC' },
              { visibility: 'MIXED' },
              membership.role === 'ADMIN' ? { visibility: 'GM_ONLY' } : {}
            ]
          },
          orderBy: { turnNumber: 'desc' },
          take: 20
        },
        scenes: {
          orderBy: { sceneNumber: 'desc' },
          take: 5,
          include: {
            playerActions: {
              include: {
                character: true,
                user: {
                  select: { id: true, email: true }
                }
              }
            }
          }
        },
        memberships: {
          include: {
            user: {
              select: { id: true, email: true }
            }
          }
        }
      }
    })

    if (!campaign) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Campaign not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      campaign,
      userRole: membership.role
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.error('Get campaign error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
