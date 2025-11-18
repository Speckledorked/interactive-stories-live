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

    console.log('🎭 New scene creation requested')
    console.log(`Campaign: ${campaignId}`)
    console.log(`User: ${user.userId}`)

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

    // 2. Check if there's already an active scene
    const existingScene = await getCurrentScene(campaignId)

    if (existingScene) {
      return NextResponse.json<ErrorResponse>(
        { 
          error: 'There is already an active scene. Resolve it first before starting a new one.',
          details: `Scene ${existingScene.sceneNumber} is ${existingScene.status}`
        },
        { status: 400 }
      )
    }

    // 3. Create new scene (this calls AI to generate intro)
    console.log('🤖 Generating new scene...')
    const newScene = await createNewScene(campaignId)

    console.log(`✅ Scene ${newScene.sceneNumber} created`)

    return NextResponse.json({
      success: true,
      message: 'New scene created',
      scene: {
        id: newScene.id,
        sceneNumber: newScene.sceneNumber,
        introText: newScene.sceneIntroText,
        status: newScene.status,
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
