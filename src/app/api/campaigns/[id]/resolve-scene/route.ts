// src/app/api/campaigns/[id]/resolve-scene/route.ts
// Resolve the current scene using AI GM
// POST /api/campaigns/:id/resolve-scene

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { getCurrentScene } from '@/lib/game/sceneResolver'
import { enqueueSceneResolution } from '@/lib/game/resolutionQueue'
import { prisma } from '@/lib/prisma'
import { AI_ACTION_LIMIT, checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'

// This route only validates and enqueues — free, like every other
// mid-scene resolution. Billing happens exactly once, when the scene
// actually ends (see end-scene/route.ts). The long AI pipeline runs in
// /api/internal/resolve-job (maxDuration 300).
export const maxDuration = 60

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id
    const body = await request.json().catch(() => ({}))
    const requestedSceneId = body.sceneId

    console.log('🎬 Scene resolution requested')
    console.log(`Campaign: ${campaignId}`)
    console.log(`User: ${user.userId}`)
    console.log(`Requested scene: ${requestedSceneId || 'current'}`)

    // Rate limit before any DB/AI work — this is the most expensive route
    // in the app (full LLM scene resolution + world turn).
    const rateLimit = await checkRateLimit(user.userId, AI_ACTION_LIMIT.bucket, AI_ACTION_LIMIT.limit, AI_ACTION_LIMIT.windowSeconds)
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    // 1. Verify user is admin of this campaign
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        memberships: {
          select: {
            userId: true,
            role: true
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

    const userMembership = campaign.memberships.find(m => m.userId === user.userId)
    if (!userMembership || userMembership.role !== 'ADMIN') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Only campaign admins can resolve scenes' },
        { status: 403 }
      )
    }

    // 2. Get target scene (either requested scene or current scene)
    let currentScene
    if (requestedSceneId) {
      currentScene = await prisma.scene.findFirst({
        where: {
          id: requestedSceneId,
          campaignId
        },
        include: {
          playerActions: {
            include: {
              character: true,
              user: true
            }
          }
        }
      })
      if (!currentScene) {
        return NextResponse.json<ErrorResponse>(
          { error: 'Scene not found' },
          { status: 404 }
        )
      }
    } else {
      currentScene = await getCurrentScene(campaignId)
    }

    if (!currentScene) {
      return NextResponse.json<ErrorResponse>(
        { error: 'No active scene to resolve' },
        { status: 400 }
      )
    }

    const sceneActions =
      ((currentScene as any).playerActions as unknown[] | undefined) ?? []

    if (sceneActions.length === 0) {
      return NextResponse.json<ErrorResponse>(
        { error: 'No player actions submitted yet. Wait for players to act.' },
        { status: 400 }
      )
    }

    console.log(
      `📝 Scene ${currentScene.sceneNumber} has ${sceneActions.length} action(s)`
    )

    // 3. Enqueue the resolution — the AI GM + world turn run behind this
    // one call, in the internal worker route's own invocation. The UI
    // follows the scene:resolving / scene:resolved Pusher events; players
    // were already watching those, not this response body.
    console.log('🤖 Enqueueing scene resolution...')
    const { jobId, deduped } = await enqueueSceneResolution(campaignId, currentScene.id)

    // 4. Return accepted — resolution completes asynchronously
    return NextResponse.json({
      success: true,
      message: deduped
        ? 'Scene resolution already in progress'
        : 'Scene resolution started — results will appear when the GM finishes',
      jobId,
      sceneNumber: currentScene.sceneNumber
    }, { status: 202 })
  } catch (error) {
    console.error('❌ Scene resolution error:', error)

    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    return NextResponse.json<ErrorResponse>(
      {
        error: 'Failed to resolve scene',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
