// src/app/api/campaigns/[id]/scenes/[sceneId]/generate-image/route.ts
// Manual/admin backfill for a single scene's illustration. The automatic
// trigger (sceneResolver.ts) only ever fires once, at a scene's FIRST
// exchange — a scene already open when sceneImageGenerationEnabled gets
// turned on (or whose one attempt failed) has no other way to ever get
// one. This is that other way: admin-only, builds the prompt from the
// scene's FIRST exchange specifically (not its current/latest one, which
// may have moved on since), and reuses the same enqueue path the
// automatic trigger uses.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { handleRouteError } from '@/lib/api/errors'
import { buildScenePrompt } from '@/lib/ai/imageGeneration'
import { enqueueSceneImageGeneration } from '@/lib/game/imageGenQueue'

// Multiple exchanges accumulate in Scene.sceneResolutionText joined by
// this separator (see sceneResolver.ts's `allResolutions`) — splitting on
// it and taking the first segment is the scene's first-exchange text,
// regardless of how many exchanges it's had since.
const RESOLUTION_SEPARATOR = '\n\n---\n\n'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; sceneId: string } }
) {
  try {
    const user = await requireAuth(request)
    const campaignId = params.id
    const sceneId = params.sceneId

    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can generate scene art')
    if ('response' in adminCheck) return adminCheck.response

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { sceneImageGenerationEnabled: true },
    })
    if (!campaign?.sceneImageGenerationEnabled) {
      return NextResponse.json(
        { error: 'Scene image generation is not enabled for this campaign — turn it on in Admin → Settings first' },
        { status: 400 }
      )
    }

    const scene = await prisma.scene.findUnique({
      where: { id: sceneId },
      select: { campaignId: true, sceneResolutionText: true, sceneIntroText: true },
    })
    if (!scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 })
    }
    if (scene.campaignId !== campaignId) {
      return NextResponse.json({ error: 'Scene does not belong to this campaign' }, { status: 400 })
    }
    if (!scene.sceneResolutionText) {
      return NextResponse.json(
        { error: 'This scene has no resolved exchange yet — there is nothing to illustrate' },
        { status: 400 }
      )
    }

    const firstExchangeText = scene.sceneResolutionText.split(RESOLUTION_SEPARATOR)[0]
    const prompt = buildScenePrompt({
      sceneIntroText: scene.sceneIntroText,
      sceneResolutionText: firstExchangeText,
    })

    const result = await enqueueSceneImageGeneration(campaignId, sceneId, prompt)

    return NextResponse.json({ status: 'PENDING', deduped: result.deduped }, { status: 202 })
  } catch (error) {
    return handleRouteError(error, 'Scene image backfill error', 'Failed to start scene image generation')
  }
}
