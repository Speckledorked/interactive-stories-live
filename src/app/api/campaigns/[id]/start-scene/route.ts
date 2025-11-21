// src/app/api/campaigns/[id]/start-scene/route.ts
// Start a new scene (creates scene intro using AI)
// POST /api/campaigns/:id/start-scene

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { createNewScene, getCurrentScene } from '@/lib/game/sceneResolver'
import { prisma } from '@/lib/prisma'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id
    const body = await request.json().catch(() => ({}))
    const { characterIds } = body

    console.log('🎭 New scene creation requested')
    console.log(`Campaign: ${campaignId}`)
    console.log(`User: ${user.userId}`)
    console.log(`Participants: ${characterIds?.length || 0} characters`)

    // 1. Verify user is admin of this campaign
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId
        }
      }
    })

    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Only campaign admins can start new scenes' },
        { status: 403 }
      )
    }

    // 2. Validate character IDs if provided
    if (characterIds && Array.isArray(characterIds) && characterIds.length > 0) {
      // Verify all characters belong to this campaign
      const characters = await prisma.character.findMany({
        where: {
          id: { in: characterIds },
          campaignId
        }
      })

      if (characters.length !== characterIds.length) {
        return NextResponse.json<ErrorResponse>(
          { error: 'One or more characters not found or do not belong to this campaign' },
          { status: 400 }
        )
      }

      // Check if any character is already in an active scene
      const activeScenes = await prisma.scene.findMany({
        where: {
          campaignId,
          status: { in: ['AWAITING_ACTIONS', 'RESOLVING'] }
        },
        select: { id: true, sceneNumber: true, participants: true }
      })

      for (const scene of activeScenes) {
        const sceneParticipants = (scene.participants as any)?.characterIds || []
        const overlap = characterIds.filter((id: string) => sceneParticipants.includes(id))
        if (overlap.length > 0) {
          return NextResponse.json<ErrorResponse>(
            {
              error: 'One or more characters are already in an active scene',
              details: `Scene ${scene.sceneNumber} already has some of these characters`
            },
            { status: 400 }
          )
        }
      }
    }

    // 3. Create new scene (this calls AI to generate intro)
    console.log('🤖 Generating new scene...')
    const newScene = await createNewScene(campaignId, characterIds)

    console.log(`✅ Scene ${newScene.sceneNumber} created`)

    return NextResponse.json({
      success: true,
      message: 'New scene created',
      scene: {
        id: newScene.id,
        sceneNumber: newScene.sceneNumber,
        introText: newScene.sceneIntroText,
        status: newScene.status,
        participants: newScene.participants,
        createdAt: newScene.createdAt
      }
    }, { status: 201 })
  } catch (error) {
    console.error('❌ Scene creation error:', error)
    
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    return NextResponse.json<ErrorResponse>(
      { 
        error: 'Failed to create scene',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
