// src/app/api/campaigns/[id]/scene/route.ts
// Scene management
// GET - Get current scene
// POST - Submit player action

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { SubmitActionRequest, ErrorResponse } from '@/types/api'
import { pusherServer } from '@/lib/pusher'

// GET active scenes
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

    // Get all active scenes (awaiting_actions or resolving)
    const activeScenes = await prisma.scene.findMany({
      where: {
        campaignId,
        status: {
          in: ['AWAITING_ACTIONS', 'RESOLVING']
        }
      },
      include: {
        playerActions: {
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

    // For backwards compatibility, also return the first scene as "scene"
    const currentScene = activeScenes.length > 0 ? activeScenes[0] : null

    return NextResponse.json({ scene: currentScene, scenes: activeScenes })
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
      where: { id: sceneId },
      include: { playerActions: true }
    })

    if (!scene || scene.status !== 'AWAITING_ACTIONS') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Scene is not accepting actions' },
        { status: 400 }
      )
    }

    // Check if character is already in another active scene
    const otherActiveScenes = await prisma.scene.findMany({
      where: {
        campaignId,
        id: { not: sceneId },
        status: { in: ['AWAITING_ACTIONS', 'RESOLVING'] }
      },
      select: { id: true, sceneNumber: true, participants: true }
    })

    for (const otherScene of otherActiveScenes) {
      const participants = (otherScene.participants as any)?.characterIds || []
      if (participants.includes(characterId)) {
        return NextResponse.json<ErrorResponse>(
          {
            error: `This character is already in another active scene (Scene ${otherScene.sceneNumber})`,
            details: 'A character can only be in one active scene at a time'
          },
          { status: 400 }
        )
      }
    }

    // Add character to scene participants if not already there
    const sceneParticipants = (scene.participants as any) || { characterIds: [], userIds: [] }
    if (!sceneParticipants.characterIds.includes(characterId)) {
      sceneParticipants.characterIds.push(characterId)
      if (!sceneParticipants.userIds.includes(user.userId)) {
        sceneParticipants.userIds.push(user.userId)
      }
      await prisma.scene.update({
        where: { id: sceneId },
        data: { participants: sceneParticipants }
      })
    }

    // Create action
    const action = await prisma.playerAction.create({
      data: {
        sceneId,
        characterId,
        userId: user.userId,
        actionText
      },
      include: {
        character: {
          select: {
            id: true,
            name: true
          }
        },
        user: {
          select: {
            id: true,
            email: true
          }
        }
      }
    })

    // Remove user from waitingOnUsers
    const waitingOnUsers = (scene.waitingOnUsers as any) || []
    const updatedWaitingOn = waitingOnUsers.filter((uid: string) => uid !== user.userId)

    await prisma.scene.update({
      where: { id: sceneId },
      data: { waitingOnUsers: updatedWaitingOn }
    })

    // Trigger Pusher event to notify all clients
    try {
      await pusherServer.trigger(
        `campaign-${campaignId}`,
        'action:created',
        {
          actionId: action.id,
          sceneId: action.sceneId,
          characterId: action.characterId,
          characterName: action.character.name,
          userId: action.userId,
          actionText: action.actionText,
          timestamp: action.createdAt
        }
      )
    } catch (pusherError) {
      console.error('Failed to trigger Pusher event:', pusherError)
      // Don't fail the request if Pusher fails
    }

    // Check if all participants have submitted - if so, auto-resolve
    const allActionsSubmitted = updatedWaitingOn.length === 0 && sceneParticipants.userIds.length > 0

    if (allActionsSubmitted) {
      console.log(`🎬 All participants submitted! Auto-resolving scene ${scene.sceneNumber}`)

      // Import and call resolveScene asynchronously (don't wait for it)
      const { resolveScene } = await import('@/lib/game/sceneResolver')
      const { runWorldTurn } = await import('@/lib/game/worldTurn')

      // Run in background - don't block the response
      resolveScene(campaignId, sceneId)
        .then(async (result) => {
          console.log(`✅ Scene ${scene.sceneNumber} auto-resolved`)
          await runWorldTurn(campaignId)

          // Trigger Pusher event for scene resolution
          await pusherServer.trigger(
            `campaign-${campaignId}`,
            'scene:resolved',
            {
              sceneId: sceneId,
              sceneNumber: scene.sceneNumber,
              timestamp: new Date()
            }
          )
        })
        .catch((error) => {
          console.error(`❌ Auto-resolve failed for scene ${scene.sceneNumber}:`, error)
        })
    }

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
