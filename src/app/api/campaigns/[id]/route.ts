// src/app/api/campaigns/[id]/route.ts
// Get specific campaign details
// GET /api/campaigns/:id

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { UserRole } from '@prisma/client'

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
          where: membership.role === 'ADMIN'
            ? {} // Admin sees all clocks
            : { isHidden: false } // Others see only public clocks
        },
        // Timeline events relation is named "timeline" in the schema
        timeline: {
          // Admin sees all events; others see only public ones
          where: membership.role === 'ADMIN'
            ? {}
            : { visibility: 'PUBLIC' },
          orderBy: { sessionDate: 'desc' },
          take: 20 // Last 20 events
        },
        scenes: {
          orderBy: { sceneNumber: 'desc' },
          take: 5, // Last 5 scenes
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

// PATCH /api/campaigns/:id - Update campaign basic info
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id

    // Check if user is an admin of this campaign
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

    if (membership.role !== UserRole.ADMIN) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Only admins can edit campaigns' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { title, description, universe } = body

    // Validate at least one field is provided
    if (!title && !description && universe === undefined) {
      return NextResponse.json<ErrorResponse>(
        { error: 'At least one field must be provided' },
        { status: 400 }
      )
    }

    // Build update object with only provided fields
    const updateData: any = {}
    if (title !== undefined) updateData.title = title
    if (description !== undefined) updateData.description = description
    if (universe !== undefined) updateData.universe = universe

    // Update the campaign
    const updatedCampaign = await prisma.campaign.update({
      where: { id: campaignId },
      data: updateData
    })

    return NextResponse.json({ campaign: updatedCampaign })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.error('Update campaign error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE /api/campaigns/:id - Delete campaign
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id

    // Check if user is an admin of this campaign
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

    if (membership.role !== UserRole.ADMIN) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Only admins can delete campaigns' },
        { status: 403 }
      )
    }

    // Delete the campaign (cascade will handle all related data)
    await prisma.campaign.delete({
      where: { id: campaignId }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.error('Delete campaign error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
