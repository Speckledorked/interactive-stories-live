// API endpoint for a GM/admin to resume a scene paused by an X-Card
// (see lib/safety/safety-service.ts pauseScene/resumeScene).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { SafetyService } from '@/lib/safety/safety-service'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; sceneId: string } }
) {
  try {
    const user = requireAuth(request)

    const campaignId = params.id
    const sceneId = params.sceneId

    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId
        }
      }
    })

    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only campaign admins can resume a paused scene' },
        { status: 403 }
      )
    }

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
    console.error('Error resuming scene:', error)
    return NextResponse.json(
      { error: 'Failed to resume scene' },
      { status: 500 }
    )
  }
}
