// src/app/api/campaigns/[id]/clocks/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'

// GET /api/campaigns/:id/clocks - List all clocks for a campaign
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

    // Check if user is a member
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'Not a member of this campaign' },
        { status: 403 }
      )
    }

    // Get clocks - admins see all, players see only visible ones
    const clocks = await prisma.clock.findMany({
      where: {
        campaignId,
        ...(membership.role === 'ADMIN' ? {} : { isHidden: false }),
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ clocks })
  } catch (error) {
    console.error('Get clocks error:', error)
    return NextResponse.json(
      { error: 'Failed to get clocks' },
      { status: 500 }
    )
  }
}

// POST /api/campaigns/:id/clocks - Create a new clock
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
    const body = await request.json()

    // Check if user is admin
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    })

    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only campaign admins can create clocks' },
        { status: 403 }
      )
    }

    // Validate required fields
    if (!body.name) {
      return NextResponse.json(
        { error: 'Clock name is required' },
        { status: 400 }
      )
    }

    // Create clock
    const clock = await prisma.clock.create({
      data: {
        campaignId,
        name: body.name,
        description: body.description || null,
        currentTicks: body.currentTicks || 0,
        maxTicks: body.maxTicks || 4,
        category: body.category || null,
        isHidden: body.isHidden !== undefined ? body.isHidden : false,
        consequence: body.consequence || null,
        gmNotes: body.gmNotes || null,
      },
    })

    return NextResponse.json({ clock }, { status: 201 })
  } catch (error) {
    console.error('Create clock error:', error)
    return NextResponse.json(
      { error: 'Failed to create clock' },
      { status: 500 }
    )
  }
}
