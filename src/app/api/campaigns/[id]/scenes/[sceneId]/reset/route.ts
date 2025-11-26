// API endpoint to manually reset a stuck scene
// This is useful when a scene gets stuck in RESOLVING state

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/auth'
import PusherServer from '@/lib/realtime/pusher-server'
import { SceneStatus } from '@prisma/client'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; sceneId: string } }
) {
  try {
    const user = await authenticateRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const sceneId = params.sceneId

    // Check if user is an admin
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.id,
          campaignId
        }
      }
    })

    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only campaign admins can reset scenes' },
        { status: 403 }
      )
    }

    // Get the scene
    const scene = await prisma.scene.findUnique({
      where: { id: sceneId }
    })

    if (!scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 })
    }

    if (scene.campaignId !== campaignId) {
      return NextResponse.json(
        { error: 'Scene does not belong to this campaign' },
        { status: 400 }
      )
    }

    // Check if scene is stuck in RESOLVING state
    if (scene.status !== 'RESOLVING') {
      return NextResponse.json(
        {
          error: `Scene is not stuck. Current status: ${scene.status}`,
          currentStatus: scene.status
        },
        { status: 400 }
      )
    }

    // Reset the scene to AWAITING_ACTIONS
    await prisma.scene.update({
      where: { id: sceneId },
      data: { status: 'AWAITING_ACTIONS' as SceneStatus }
    })

    console.log(`✅ Scene ${sceneId} manually reset from RESOLVING to AWAITING_ACTIONS by admin ${user.email}`)

    // Broadcast the reset via Pusher so all clients update
    try {
      const pusher = PusherServer()
      if (pusher) {
        await pusher.trigger(`campaign-${campaignId}`, 'scene:reset', {
          sceneId,
          sceneNumber: scene.sceneNumber,
          campaignId,
          resetBy: user.email
        })
        console.log('📡 Broadcasted scene:reset event via Pusher')
      }
    } catch (pusherError) {
      console.error('⚠️ Failed to broadcast Pusher reset event:', pusherError)
      // Don't fail the request if Pusher fails
    }

    return NextResponse.json({
      success: true,
      message: 'Scene has been reset to AWAITING_ACTIONS',
      sceneId,
      previousStatus: 'RESOLVING',
      newStatus: 'AWAITING_ACTIONS'
    })
  } catch (error) {
    console.error('Error resetting scene:', error)
    return NextResponse.json(
      { error: 'Failed to reset scene' },
      { status: 500 }
    )
  }
}
