// src/app/api/campaigns/[id]/resolve-scene/route.ts
// Resolve the current scene using AI GM
// POST /api/campaigns/:id/resolve-scene

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { resolveScene, getCurrentScene } from '@/lib/game/sceneResolver'
import { runWorldTurn } from '@/lib/game/worldTurn'
import { prisma } from '@/lib/prisma'
import { checkBalance, deductFunds, formatCurrency } from '@/lib/payment/service'

// Per-player cost in cents based on number of players in the scene
function getSceneCostPerPlayer(playerCount: number): number {
  if (playerCount <= 1) return 25  // $0.25 solo
  if (playerCount <= 4) return 50  // $0.50 small group
  return 75                         // $0.75 large group
}

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

    // 3. Charge each participating player based on group size
    const participants = (currentScene.participants as any) || {}
    const participantUserIds: string[] = participants.userIds || []
    const playerCount = participantUserIds.length
    const costPerPlayer = getSceneCostPerPlayer(playerCount)

    console.log(`💰 Charging ${playerCount} player(s) ${formatCurrency(costPerPlayer)} each`)

    // Check all participants have sufficient balance before charging anyone
    const balanceChecks = await Promise.all(
      participantUserIds.map(uid => checkBalance(uid, costPerPlayer))
    )
    const shortfall = balanceChecks.find(b => !b.sufficient)
    if (shortfall) {
      return NextResponse.json<ErrorResponse>(
        {
          error: 'Insufficient balance',
          details: `One or more players do not have enough balance to resolve this scene. Each player needs ${formatCurrency(costPerPlayer)} (${playerCount} player${playerCount !== 1 ? 's' : ''} in scene).`
        },
        { status: 402 }
      )
    }

    // Deduct from each participant
    for (const uid of participantUserIds) {
      await deductFunds(
        uid,
        costPerPlayer,
        `Scene #${currentScene.sceneNumber} resolution (${playerCount} player${playerCount !== 1 ? 's' : ''})`,
        { sceneId: currentScene.id, campaignId }
      )
    }

    // 5. Resolve the scene (this calls AI and updates DB)
    console.log('🤖 Calling scene resolver...')
    const resolutionResult = await resolveScene(campaignId, currentScene.id)

    // 6. Run world turn (advance clocks, generate background events)
    console.log('🌍 Running world turn...')
    const worldTurnResult = await runWorldTurn(campaignId)

    // 7. Return success
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
