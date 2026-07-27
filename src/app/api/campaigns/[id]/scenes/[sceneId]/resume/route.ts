// API endpoint for a GM/admin to resume a scene paused by an X-Card
// (see lib/safety/safety-service.ts pauseScene/resumeScene).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { SafetyService } from '@/lib/safety/safety-service'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { handleRouteError } from '@/lib/api/errors'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; sceneId: string } }
) {
  try {
    const user = await requireAuth(request)

    const campaignId = params.id
    const sceneId = params.sceneId

    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can resume a paused scene')
    if ('response' in adminCheck) return adminCheck.response

    const scene = await prisma.scene.findUnique({
      where: { id: sceneId }
    })

    if (!scene || scene.campaignId !== campaignId) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 })
    }

    if (!scene.isPaused) {
      return NextResponse.json(
        { error: 'Scene is not paused' },
        { status: 400 }
      )
    }

    const resumed = await SafetyService.resumeScene(sceneId)

    return NextResponse.json({
      success: true,
      sceneId,
      isPaused: resumed.isPaused
    })
  } catch (error) {
    // Called-out fix, not a silent behavior change: see tutorial/trigger/
    // route.ts's comment — this route had the same missing 401 case.
    return handleRouteError(error, 'Error resuming scene', 'Failed to resume scene')
  }
}
