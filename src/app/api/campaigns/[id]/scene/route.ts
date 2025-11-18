// src/app/api/campaigns/[id]/scene/route.ts
// Scene management
// GET - Get current scene
// POST - Submit player action

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { SubmitActionRequest, ErrorResponse } from '@/types/api'

// GET current scene
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id

    // Check membership
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

    // Get current active scene (awaiting_actions or resolving)
    const currentScene = await prisma.scene.findFirst({
      where: {
        campaignId,
        status: {
          in: ['AWAITING_ACTIONS', 'RESOLVING']
        }
      },
      include: {
        actions: {
          include: {
            character: true,
            user: {
              select: { id: true, email: true }
            }
          }
        }
      },
      orderBy: { sceneNumber: 'desc' }
    })

    return NextResponse.json({ scene: currentScene })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.error('Get scene error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Submit action for current scene
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id
    const body: SubmitActionRequest = await request.json()

    const { sceneId, characterId, actionText } = body

    // Validate input
    if (!sceneId || !characterId || !actionText) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Scene ID, character ID, and action text are required' },
        { status: 400 }
      )
    }

    // Verify character belongs to user
    const character = await prisma.character.findUnique({
      where: { id: characterId }
    })

    if (!character || character.userId !== user.userId) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Character not found or does not belong to you' },
        { status: 403 }
      )
    }

    // Verify scene is accepting actions
    const scene = await prisma.scene.findUnique({
      where: { id: sceneId }
    })

    if (!scene || scene.status !== 'AWAITING_ACTIONS') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Scene is not accepting actions' },
        { status: 400 }
      )
    }

    // Create action
    const action = await prisma.playerAction.create({
      data: {
        campaignId,
        sceneId,
        characterId,
        userId: user.userId,
        actionText
      }
    })

    return NextResponse.json({ action }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.error('Submit action error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
