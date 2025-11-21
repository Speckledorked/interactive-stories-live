// src/app/api/campaigns/[id]/rolls/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { calculateOutcome } from '@/lib/pbta-moves'

interface RollRequest {
  characterId: string
  sceneId?: string
  moveId?: string
  rollType: 'move' | 'custom' | 'help' | 'interfere'
  modifier?: number
  description?: string
  isSecret?: boolean
  stat?: string // 'cool', 'hard', 'hot', 'sharp', 'weird'
}

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
    const body: RollRequest = await request.json()

    // Verify character ownership
    const character = await prisma.character.findFirst({
      where: {
        id: body.characterId,
        userId: user.userId,
        campaignId,
      },
      include: {
        user: {
          select: { name: true, email: true }
        }
      }
    })

    if (!character) {
      return NextResponse.json(
        { error: 'Character not found or not yours' },
        { status: 403 }
      )
    }

    // Roll 2d6
    const dice = [
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1
    ]

    // Calculate modifier based on stat
    let modifier = body.modifier || 0
    if (body.stat && character.stats && typeof character.stats === 'object') {
      const stats = character.stats as Record<string, number>
      modifier += stats[body.stat] || 0
    }

    // Add any holds/forward from character
    if (character.holds && typeof character.holds === 'object') {
      const holds = character.holds as { forward?: number; ongoing?: number }
      if (holds.forward && holds.forward > 0) {
        modifier += holds.forward
        // Clear the forward after use
        await prisma.character.update({
          where: { id: character.id },
          data: {
            holds: {
              ...holds,
              forward: 0
            }
          }
        })
      }
      if (holds.ongoing) {
        modifier += holds.ongoing
      }
    }

    const total = dice[0] + dice[1] + modifier
    const outcome = calculateOutcome(total)

    // Create the roll record
    const roll = await prisma.diceRoll.create({
      data: {
        campaignId,
        sceneId: body.sceneId,
        characterId: body.characterId,
        userId: user.userId,
        rollType: body.rollType,
        moveId: body.moveId,
        dice,
        modifier,
        total,
        outcome,
        description: body.description,
        isSecret: body.isSecret || false,
      },
      include: {
        character: true,
        move: true,
      }
    })

    // If this was part of a player action, update it
    if (body.sceneId) {
      const latestAction = await prisma.playerAction.findFirst({
        where: {
          sceneId: body.sceneId,
          characterId: body.characterId,
          status: 'pending'
        },
        orderBy: {
          createdAt: 'desc'
        }
      })

      if (latestAction) {
        await prisma.playerAction.update({
          where: { id: latestAction.id },
          data: {
            rollMade: roll.id,
            moveUsed: body.moveId
          }
        })
      }
    }

    return NextResponse.json({ roll })
  } catch (error) {
    console.error('Roll error:', error)
    return NextResponse.json(
      { error: 'Failed to process roll' },
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
    const { searchParams } = new URL(request.url)
    const sceneId = searchParams.get('sceneId')
    const limit = parseInt(searchParams.get('limit') || '20')

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

    // Get rolls
    const rolls = await prisma.diceRoll.findMany({
      where: {
        campaignId,
        ...(sceneId && { sceneId }),
        // Don't show secret rolls unless they're yours
        OR: [
          { isSecret: false },
          { userId: user.userId }
        ]
      },
      include: {
        character: {
          select: {
            name: true,
            user: {
              select: {
                name: true,
                email: true
              }
            }
          }
        },
        move: true,
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: limit
    })

    return NextResponse.json({ rolls })
  } catch (error) {
    console.error('Get rolls error:', error)
    return NextResponse.json(
      { error: 'Failed to get rolls' },
      { status: 500 }
    )
  }
}
