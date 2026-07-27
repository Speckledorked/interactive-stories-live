// src/app/api/campaigns/[id]/scenes/[sceneId]/route.ts
// Admin-only permanent deletion of a scene — for cleaning up a mistake
// (wrong split grouping, an accidental duplicate) before it's gone anywhere.
// Restricted to a scene nobody has acted on and that hasn't resolved yet,
// same safety condition regenerate-intro/route.ts uses: once a resolution
// has happened, its consequences (stat changes, world-turn effects,
// CampaignLog/TimelineEvent entries) are already baked into the rest of the
// campaign and deleting the Scene row wouldn't undo any of that — it would
// just leave those other records pointing at a scene that no longer exists.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { handleRouteError } from '@/lib/api/errors'
import PusherServer from '@/lib/realtime/pusher-server'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; sceneId: string } }
) {
  try {
    const user = await requireAuth(request)
    const campaignId = params.id
    const sceneId = params.sceneId

    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can delete scenes')
    if ('response' in adminCheck) return adminCheck.response

    const scene = await prisma.scene.findUnique({
      where: { id: sceneId },
      include: { playerActions: { select: { id: true } } }
    })

    if (!scene || scene.campaignId !== campaignId) {
      return NextResponse.json<ErrorResponse>({ error: 'Scene not found' }, { status: 404 })
    }

    if (scene.playerActions.length > 0 || scene.sceneResolutionText) {
      return NextResponse.json<ErrorResponse>(
        { error: 'This scene already has actions or a resolution — only an untouched scene can be deleted.' },
        { status: 400 }
      )
    }

    await prisma.scene.delete({ where: { id: sceneId } })

    console.log(`🗑️ Scene ${sceneId} (#${scene.sceneNumber}) deleted from campaign ${campaignId} by admin ${user.email}`)

    try {
      const pusher = PusherServer()
      if (pusher) {
        await pusher.trigger(`campaign-${campaignId}`, 'scene:deleted', {
          sceneId,
          sceneNumber: scene.sceneNumber,
          campaignId,
          deletedBy: user.email
        })
      }
    } catch (pusherError) {
      console.error('⚠️ Failed to broadcast scene:deleted event:', pusherError)
    }

    return NextResponse.json({ success: true, sceneId })
  } catch (error) {
    return handleRouteError(error, 'Error deleting scene', 'Failed to delete scene')
  }
}
