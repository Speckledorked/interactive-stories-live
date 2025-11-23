// src/app/api/campaigns/[id]/resolve-scene/route.ts
// Resolve the current scene using AI GM
// POST /api/campaigns/:id/resolve-scene

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { resolveScene, getCurrentScene } from '@/lib/game/sceneResolver'
import { runWorldTurn } from '@/lib/game/worldTurn'
import { prisma } from '@/lib/prisma'
import { checkBalance, deductFunds, calculateResolutionCost, formatCurrency } from '@/lib/payment/service'

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

    // 1. Verify user is admin of this campaign AND get player count for pricing
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

    // Calculate player count and cost for this scene resolution
    const playerCount = campaign.memberships.length
    const resolutionCost = calculateResolutionCost(playerCount)

    console.log(`👥 Player count: ${playerCount}`)
    console.log(`💵 Resolution cost: ${formatCurrency(resolutionCost)}`)

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
    const balanceCheck = await checkBalance(user.userId, resolutionCost)

    if (!balanceCheck.sufficient) {
      return NextResponse.json<ErrorResponse>(
        {
          error: 'Insufficient balance',
          details: `You need ${formatCurrency(resolutionCost)} to resolve a scene with ${playerCount} player${playerCount !== 1 ? 's' : ''}. Your current balance is ${formatCurrency(balanceCheck.currentBalance)}. Please add funds to your account.`
        },
        { status: 402 } // 402 Payment Required
      )
    }

    // 4. CRITICAL: Deduct funds BEFORE resolution to prevent free resolutions
    console.log('💳 Deducting funds BEFORE resolution...')
    const deductResult = await deductFunds(
      user.userId,
      resolutionCost,
      `AI scene resolution for campaign ${campaignId} (${playerCount} player${playerCount !== 1 ? 's' : ''})`,
      {
        campaignId,
        sceneId: currentScene.id,
        sceneNumber: currentScene.sceneNumber,
        playerCount,
        costPerScene: resolutionCost
      }
    )

    if (!deductResult.success) {
      console.error('❌ Failed to deduct funds:', deductResult.error)
      return NextResponse.json<ErrorResponse>(
        {
          error: 'Payment failed',
          details: deductResult.error || 'Unable to process payment. Please try again.'
        },
        { status: 402 }
      )
    }

    // 5. Resolve the scene (this calls AI and updates DB)
    console.log('🤖 Calling scene resolver...')
    let resolutionResult
    try {
      resolutionResult = await resolveScene(campaignId, currentScene.id)
    } catch (error) {
      // If resolution fails, refund the user
      console.error('❌ Scene resolution failed, refunding user:', error)
      await prisma.transaction.create({
        data: {
          userId: user.userId,
          type: 'REFUND',
          amount: resolutionCost,
          balanceBefore: deductResult.newBalance,
          balanceAfter: deductResult.newBalance + resolutionCost,
          description: `Refund for failed scene resolution (campaign ${campaignId})`,
          metadata: {
            campaignId,
            sceneId: currentScene.id,
            originalTransactionId: deductResult.transactionId,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        }
      })

      // Update user balance
      await prisma.user.update({
        where: { id: user.userId },
        data: { balance: { increment: resolutionCost } }
      })

      throw error // Re-throw to be handled by outer catch block
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
        charged: formatCurrency(resolutionCost),
        newBalance: formatCurrency(deductResult.newBalance),
        playerCount,
        chargedBefore: true // Indicates payment was taken before resolution
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
