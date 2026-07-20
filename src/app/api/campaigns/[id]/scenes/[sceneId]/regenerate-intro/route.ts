// src/app/api/campaigns/[id]/scenes/[sceneId]/regenerate-intro/route.ts
// Re-roll a scene's intro text — for a fresh scene nobody has acted on
// yet (a bad first draft, or replaying an old scene under a prompt fix
// without losing anyone's already-submitted response). Any member can
// trigger it, same as starting a scene in the first place: there's no
// human GM in this product, so redoing an opener is a table decision,
// not a hosting duty.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { prisma } from '@/lib/prisma'
import { generateNewSceneIntro } from '@/lib/ai/worldState'
import { AI_ACTION_LIMIT, checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { isWorldSeeding, SEEDING_MESSAGE } from '@/lib/lore/seedingGate'
import PusherServer from '@/lib/realtime/pusher-server'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; sceneId: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id
    const sceneId = params.sceneId

    // Regenerating an intro is an LLM call, same cost profile as starting
    // a scene in the first place.
    const rateLimit = await checkRateLimit(user.userId, AI_ACTION_LIMIT.bucket, AI_ACTION_LIMIT.limit, AI_ACTION_LIMIT.windowSeconds)
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

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

    if (await isWorldSeeding(campaignId)) {
      return NextResponse.json({ error: SEEDING_MESSAGE, worldSeeding: true }, { status: 409 })
    }

    const scene = await prisma.scene.findUnique({
      where: { id: sceneId },
      include: { playerActions: { select: { id: true } } }
    })

    if (!scene || scene.campaignId !== campaignId) {
      return NextResponse.json<ErrorResponse>({ error: 'Scene not found' }, { status: 404 })
    }

    // Only an untouched scene can be redone safely — once someone has
    // acted, or the scene has already resolved once, swapping the intro
    // out from under that history would orphan it.
    if (scene.playerActions.length > 0 || scene.sceneResolutionText) {
      return NextResponse.json<ErrorResponse>(
        { error: 'This scene already has actions or a resolution — only an untouched scene intro can be regenerated.' },
        { status: 400 }
      )
    }

    if (scene.status !== 'AWAITING_ACTIONS') {
      return NextResponse.json<ErrorResponse>(
        { error: `Scene is not ready to regenerate (status: ${scene.status})` },
        { status: 400 }
      )
    }

    // Preserve whatever participant scope the scene was created with (a
    // split-party/Character-Focused scene stays scoped to the same
    // characters; an open scene stays open).
    const characterIds = (scene.participants as any)?.characterIds as string[] | undefined

    const newIntroText = await generateNewSceneIntro(campaignId, characterIds)

    const updatedScene = await prisma.scene.update({
      where: { id: sceneId },
      data: { sceneIntroText: newIntroText }
    })

    try {
      const pusher = PusherServer()
      if (pusher) {
        await pusher.trigger(`campaign-${campaignId}`, 'scene:regenerated', {
          sceneId,
          campaignId,
          sceneNumber: scene.sceneNumber
        })
      }
    } catch (pusherError) {
      console.error('⚠️ Failed to broadcast scene:regenerated event:', pusherError)
    }

    return NextResponse.json({
      success: true,
      scene: {
        id: updatedScene.id,
        sceneNumber: updatedScene.sceneNumber,
        introText: updatedScene.sceneIntroText
      }
    })
  } catch (error) {
    console.error('❌ Scene regeneration error:', error)

    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json<ErrorResponse>(
      {
        error: 'Failed to regenerate scene',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
