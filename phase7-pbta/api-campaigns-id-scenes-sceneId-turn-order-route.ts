// src/app/api/campaigns/[id]/scenes/[sceneId]/turn-order/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { pusherServer } from '@/lib/pusher'

interface TurnOrderEntry {
  characterId: string
  characterName: string
  initiative: number
  hasActed: boolean
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; sceneId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, sceneId } = params

    // Check if user is admin
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.id,
          campaignId,
        },
      },
    })

    if (!membership || membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only admins can manage turn order' },
        { status: 403 }
      )
    }

    // Get all characters in the scene
    const scene = await prisma.scene.findUnique({
      where: { id: sceneId },
    })

    if (!scene || scene.campaignId !== campaignId) {
      return NextResponse.json(
        { error: 'Scene not found' },
        { status: 404 }
      )
    }

    // Get active characters
    const characters = await prisma.character.findMany({
      where: {
        campaignId,
        isAlive: true,
      },
      select: {
        id: true,
        name: true,
        stats: true,
      },
    })

    // Roll initiative for each character (2d6 + cool)
    const order: TurnOrderEntry[] = characters.map(char => {
      const roll = Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1
      const stats = (char.stats as any) || {}
      const coolMod = stats.cool || 0
      const initiative = roll + coolMod

      return {
        characterId: char.id,
        characterName: char.name,
        initiative,
        hasActed: false,
      }
    })

    // Sort by initiative (highest first)
    order.sort((a, b) => b.initiative - a.initiative)

    // Create or update turn order
    const turnOrder = await prisma.turnOrder.upsert({
      where: { sceneId },
      create: {
        sceneId,
        order,
        currentTurn: 0,
        roundNumber: 1,
        isActive: true,
      },
      update: {
        order,
        currentTurn: 0,
        roundNumber: 1,
        isActive: true,
      },
    })

    // Broadcast turn order
    await pusherServer.trigger(
      `campaign-${campaignId}`,
      'turnOrder:initialized',
      {
        sceneId,
        order,
        currentTurn: 0,
        roundNumber: 1,
      }
    )

    return NextResponse.json({ turnOrder })
  } catch (error) {
    console.error('Initialize turn order error:', error)
    return NextResponse.json(
      { error: 'Failed to initialize turn order' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; sceneId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, sceneId } = params
    const body = await request.json()

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
        { error: 'Not a campaign member' },
        { status: 403 }
      )
    }

    // Get current turn order
    const turnOrder = await prisma.turnOrder.findUnique({
      where: { sceneId },
    })

    if (!turnOrder || !turnOrder.isActive) {
      return NextResponse.json(
        { error: 'No active turn order' },
        { status: 404 }
      )
    }

    const order = turnOrder.order as TurnOrderEntry[]
    let currentTurn = turnOrder.currentTurn
    let roundNumber = turnOrder.roundNumber

    // Handle different actions
    if (body.action === 'next') {
      // Mark current character as having acted
      if (order[currentTurn]) {
        order[currentTurn].hasActed = true
      }

      // Move to next character
      currentTurn++

      // Check if round is complete
      if (currentTurn >= order.length) {
        currentTurn = 0
        roundNumber++
        // Reset hasActed for all characters
        order.forEach(entry => {
          entry.hasActed = false
        })
      }
    } else if (body.action === 'endTurn' && body.characterId) {
      // Mark specific character as having acted
      const charIndex = order.findIndex(e => e.characterId === body.characterId)
      if (charIndex !== -1) {
        order[charIndex].hasActed = true
      }
    } else if (body.action === 'end') {
      // End the turn order
      await prisma.turnOrder.update({
        where: { sceneId },
        data: { isActive: false },
      })

      await pusherServer.trigger(
        `campaign-${campaignId}`,
        'turnOrder:ended',
        { sceneId }
      )

      return NextResponse.json({ message: 'Turn order ended' })
    }

    // Update turn order
    const updated = await prisma.turnOrder.update({
      where: { sceneId },
      data: {
        order,
        currentTurn,
        roundNumber,
      },
    })

    // Broadcast update
    await pusherServer.trigger(
      `campaign-${campaignId}`,
      'turnOrder:updated',
      {
        sceneId,
        order,
        currentTurn,
        roundNumber,
        currentCharacter: order[currentTurn],
      }
    )

    return NextResponse.json({ turnOrder: updated })
  } catch (error) {
    console.error('Update turn order error:', error)
    return NextResponse.json(
      { error: 'Failed to update turn order' },
      { status: 500 }
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; sceneId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, sceneId } = params

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
        { error: 'Not a campaign member' },
        { status: 403 }
      )
    }

    // Get turn order
    const turnOrder = await prisma.turnOrder.findUnique({
      where: { sceneId },
    })

    return NextResponse.json({ turnOrder })
  } catch (error) {
    console.error('Get turn order error:', error)
    return NextResponse.json(
      { error: 'Failed to get turn order' },
      { status: 500 }
    )
  }
}