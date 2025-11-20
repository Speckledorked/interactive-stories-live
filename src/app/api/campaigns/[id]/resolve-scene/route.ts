// src/app/api/campaigns/[id]/resolve-scene/route.ts
// Resolve the current scene using AI GM
// POST /api/campaigns/:id/resolve-scene

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { resolveScene, getCurrentScene } from '@/lib/game/sceneResolver'
import { runWorldTurn } from '@/lib/game/worldTurn'
import { prisma } from '@/lib/prisma'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id

    console.log('🎬 Scene resolution requested')
    console.log(`Campaign: ${campaignId}`)
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
        { error: 'Only campaign admins can resolve scenes' },
        { status: 403 }
      )
    }

    // 2. Get current active scene
    const currentScene = await getCurrentScene(campaignId)

    if (!currentScene) {
      return NextResponse.json<ErrorResponse>(
        { error: 'No active scene to resolve' },
        { status: 400 }
      )
    }

    // FIX: Scenes use "playerActions" not "actions"
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

    // 3. Resolve the scene (this calls AI and updates DB)
    console.log('🤖 Calling scene resolver...')
    const resolutionResult = await resolveScene(campaignId, currentScene.id)

    // 4. Run world turn (advance clocks, generate background events)
    console.log('🌍 Running world turn...')
    const worldTurnResult = await runWorldTurn(campaignId)

    // 5. Return success with results
    return NextResponse.json({
      success: true,
      message: 'Scene resolved successfully',
      resolution: {
        sceneNumber: currentScene.sceneNumber,
        sceneText: resolutionResult.sceneText,
        updatesApplied: resolutionResult.updates,
        newTurnNumber: resolutionResult.newTurnNumber
      },
      worldTurn: {
        clocksAdvanced: worldTurnResult.clocksAdvanced,
        clocksCompleted: worldTurnResult.clocksCompleted
      }
    })
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
