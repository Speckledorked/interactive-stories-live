// src/app/api/campaigns/[id]/end-scene/route.ts
// End a scene (marks it as RESOLVED)
// POST /api/campaigns/:id/end-scene

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { prisma } from '@/lib/prisma'
import { SceneStatus } from '@prisma/client'
import PusherServer from '@/lib/realtime/pusher-server'
import { AI_ACTION_LIMIT, checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'

// 60s = Vercel Hobby-tier ceiling, safe on every plan. See scene/route.ts for
// the full rationale — this route awaits the same resolveScene() call.
export const maxDuration = 60

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

    // Rate limit before any DB/AI work — ending a scene can trigger a
    // final resolution pass and the world turn (LLM calls).
    const rateLimit = await checkRateLimit(user.userId, AI_ACTION_LIMIT.bucket, AI_ACTION_LIMIT.limit, AI_ACTION_LIMIT.windowSeconds)
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

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

    if (scene.status === 'RESOLVED') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Scene already ended' },
        { status: 400 }
      )
    }

    // 2.5. Billing is metered on real AI cost (resolutionBilling.ts sums
    // AICostEntry rows for this scene), which the FINAL resolution call
    // below hasn't recorded yet — so this preflight check is a
    // conservative estimate (cost so far + a buffer), just to block an
    // obviously unaffordable attempt before spending on one more call.
    // The real charge happens after resolution, once its cost is known.
    const { preflightSceneBilling, chargeForSceneResolution } = await import('@/lib/game/resolutionBilling')
    const preflight = await preflightSceneBilling(sceneId)
    if (!preflight.ok) {
      return NextResponse.json<ErrorResponse>(
        { error: preflight.error || 'Insufficient balance', details: preflight.details },
        { status: 402 }
      )
    }

    // 3. If scene has actions, trigger AI resolution first
    if (scene.playerActions.length > 0) {
      console.log('🎬 Triggering final resolution before ending scene')

      try {
        // Import resolution functions
        const { resolveScene } = await import('@/lib/game/sceneResolver')
        const { runWorldTurnIfDue } = await import('@/lib/game/worldTurn')

        // Resolve the scene to generate final AI response
        await resolveScene(campaignId, sceneId)
        console.log('✅ Final resolution complete')

        // World turn paced by in-game time — scene ending doesn't itself
        // mean fiction time passed (see lib/game/tick/pacing.ts).
        const { ran } = await runWorldTurnIfDue(campaignId)
        console.log(ran ? '✅ World turn complete' : '✅ World turn not due yet')
      } catch (error) {
        console.error('❌ Final resolution failed:', error)
        // Continue to mark as RESOLVED even if resolution fails
        // The admin explicitly wants to end this scene
      }
    }

    // 3.5. The real, metered charge: sums every AICostEntry this scene
    // recorded across all its exchanges plus the final call above. Runs
    // regardless of whether resolution just succeeded or failed — the AI
    // spend already happened either way. Best-effort: a failure here
    // (e.g. a balance that ran out between the preflight estimate and now)
    // is logged, not blocking — the scene has already been resolved and
    // there's no undoing the AI spend by refusing to mark it RESOLVED.
    const charge = await chargeForSceneResolution(campaignId, sceneId)
    if (!charge.ok) {
      console.error('⚠️ Scene resolved but metered billing failed:', charge.error, charge.details)
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
