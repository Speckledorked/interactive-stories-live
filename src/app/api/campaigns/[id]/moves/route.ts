// src/app/api/campaigns/[id]/moves/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { BASIC_MOVES, PERIPHERAL_MOVES } from '@/lib/pbta-moves'
import { UserRole } from '@prisma/client'

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

    if (!membership || membership.role !== UserRole.ADMIN) {
      return NextResponse.json(
        { error: 'Only admins can create moves' },
        { status: 403 }
      )
    }

    // Create custom move
    const move = await prisma.move.create({
      data: {
        campaignId,
        name: body.name,
        trigger: body.trigger,
        description: body.description,
        rollType: body.rollType,
        outcomes: body.outcomes || {},
        category: body.category || 'custom',
        isActive: body.isActive !== false,
      },
    })

    return NextResponse.json({ move })
  } catch (error) {
    console.error('Create move error:', error)
    return NextResponse.json(
      { error: 'Failed to create move' },
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
          userId: user.userId,
          campaignId,
        },
      },
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'Not a campaign member' },
        { status: 403 }
      )
    }

    // Get custom moves for this campaign
    const customMoves = await prisma.move.findMany({
      where: {
        campaignId,
        isActive: true,
      },
      orderBy: {
        category: 'asc',
        name: 'asc',
      },
    })

    // Combine with basic moves
    const moves = {
      basic: BASIC_MOVES,
      peripheral: PERIPHERAL_MOVES,
      custom: customMoves,
    }

    return NextResponse.json({ moves })
  } catch (error) {
    console.error('Get moves error:', error)
    return NextResponse.json(
      { error: 'Failed to get moves' },
      { status: 500 }
    )
  }
}

// Initialize default moves for a campaign
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id

    // Check if user is admin
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    })

    if (!membership || membership.role !== UserRole.ADMIN) {
      return NextResponse.json(
        { error: 'Only admins can initialize moves' },
        { status: 403 }
      )
    }

    // Check if moves already exist
    const existingMoves = await prisma.move.count({
      where: { campaignId }
    })

    if (existingMoves > 0) {
      return NextResponse.json(
        { message: 'Moves already initialized' },
        { status: 200 }
      )
    }

    // Create all basic moves
    const movesToCreate = [...BASIC_MOVES, ...PERIPHERAL_MOVES].map(move => ({
      campaignId,
      name: move.name,
      trigger: move.trigger,
      description: move.description,
      rollType: move.rollType || null,
      outcomes: move.outcomes,
      category: move.category,
      isActive: true,
    }))

    await prisma.move.createMany({
      data: movesToCreate,
    })

    return NextResponse.json({
      message: 'Moves initialized successfully',
      count: movesToCreate.length
    })
  } catch (error) {
    console.error('Initialize moves error:', error)
    return NextResponse.json(
      { error: 'Failed to initialize moves' },
      { status: 500 }
    )
  }
}
