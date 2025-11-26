// src/app/api/campaigns/[id]/end-scene/route.ts
// End a scene (marks it as RESOLVED)
// POST /api/campaigns/:id/end-scene

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { prisma } from '@/lib/prisma'
import { SceneStatus } from '@prisma/client'
import PusherServer from '@/lib/realtime/pusher-server'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id
    const body = await request.json()
    const { sceneId } = body

    console.log('🏁 Scene end requested')
    console.log(`Campaign: ${campaignId}`)
    console.log(`Scene: ${sceneId}`)
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
        { error: 'Only campaign admins can end scenes' },
        { status: 403 }
      )
    }

    // 2. Verify scene exists and belongs to campaign
    const scene = await prisma.scene.findUnique({
      where: { id: sceneId },
      include: {
        playerActions: true
      }
    })

    if (!scene || scene.campaignId !== campaignId) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Scene not found' },
        { status: 404 }
      )
    }

    // 3. If scene has actions and is not already resolved, trigger AI resolution first
    if (scene.playerActions.length > 0 && scene.status !== 'RESOLVED') {
      console.log('🎬 Triggering final resolution before ending scene')

      try {
        // Import resolution functions
        const { resolveScene } = await import('@/lib/game/sceneResolver')
        const { runWorldTurn } = await import('@/lib/game/worldTurn')

        // Resolve the scene to generate final AI response
        await resolveScene(campaignId, sceneId)
        console.log('✅ Final resolution complete')

        // Run world turn to process any final updates
        await runWorldTurn(campaignId)
        console.log('✅ World turn complete')
      } catch (error) {
        console.error('❌ Final resolution failed:', error)
        // Continue to mark as RESOLVED even if resolution fails
        // The admin explicitly wants to end this scene
      }
    }

    // 4. Mark scene as RESOLVED
    await prisma.scene.update({
      where: { id: sceneId },
      data: {
        status: 'RESOLVED' as SceneStatus
      }
    })

    console.log('✅ Scene ended and marked as RESOLVED')

    // 4. Broadcast scene end event
    const pusher = PusherServer()
    if (pusher) {
      await pusher.trigger(`campaign-${campaignId}`, 'scene:ended', {
        sceneId,
        sceneNumber: scene.sceneNumber
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Scene ended successfully'
    })
  } catch (error) {
    console.error('❌ End scene error:', error)

    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    return NextResponse.json<ErrorResponse>(
      {
        error: 'Failed to end scene',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
