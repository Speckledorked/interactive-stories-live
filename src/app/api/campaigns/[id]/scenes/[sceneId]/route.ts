// src/app/api/campaigns/[id]/scenes/[sceneId]/route.ts
// Admin-only permanent deletion of a scene — for cleaning up a mistake
// (wrong split grouping, an accidental duplicate, a scene that's gone
// somewhere nobody wants) at any point in its life, not just before
// anyone's acted. Deleting a scene that's already resolved doesn't undo
// its consequences elsewhere (stat changes, world-turn effects,
// CampaignLog/TimelineEvent entries stay — they just end up pointing at a
// scene that no longer exists), which is why this is admin-gated and the
// frontend confirm dialog says so explicitly.

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

    const scene = await prisma.scene.findUnique({ where: { id: sceneId } })

    if (!scene || scene.campaignId !== campaignId) {
      return NextResponse.json<ErrorResponse>({ error: 'Scene not found' }, { status: 404 })
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
