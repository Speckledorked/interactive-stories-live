// src/app/api/campaigns/[id]/resolve-scene/route.ts
// Resolve the current scene using AI GM
// POST /api/campaigns/:id/resolve-scene

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { resolveScene, getCurrentScene } from '@/lib/game/sceneResolver'
import { runWorldTurn } from '@/lib/game/worldTurn'
import { prisma } from '@/lib/prisma'
import { checkBalance, deductFunds, COST_PER_RESOLUTION, formatCurrency } from '@/lib/payment/service'

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

    // 3. Check if user has sufficient balance
    console.log('💰 Checking user balance...')
    const balanceCheck = await checkBalance(user.userId, COST_PER_RESOLUTION)

    if (!balanceCheck.sufficient) {
      return NextResponse.json<ErrorResponse>(
        {
          error: 'Insufficient balance',
          details: `You need ${formatCurrency(COST_PER_RESOLUTION)} to resolve a scene. Your current balance is ${formatCurrency(balanceCheck.currentBalance)}. Please add funds to your account.`
        },
        { status: 402 } // 402 Payment Required
      )
    }

    // 4. Resolve the scene (this calls AI and updates DB)
    console.log('🤖 Calling scene resolver...')
    const resolutionResult = await resolveScene(campaignId, currentScene.id)

    // 5. Deduct funds from user's balance
    console.log('💳 Deducting funds...')
    const deductResult = await deductFunds(
      user.userId,
      COST_PER_RESOLUTION,
      `AI scene resolution for campaign ${campaignId}`,
      {
        campaignId,
        sceneId: currentScene.id,
        sceneNumber: currentScene.sceneNumber
      }
    )

    if (!deductResult.success) {
      console.error('⚠️ Failed to deduct funds (scene already resolved):', deductResult.error)
      // Note: We don't fail the request if deduction fails after resolution,
      // but we log it for manual review
    }

    // 6. Run world turn (advance clocks, generate background events)
    console.log('🌍 Running world turn...')
    const worldTurnResult = await runWorldTurn(campaignId)

    // 7. Return success with results
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
      },
      payment: {
        charged: formatCurrency(COST_PER_RESOLUTION),
        newBalance: formatCurrency(deductResult.newBalance)
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
