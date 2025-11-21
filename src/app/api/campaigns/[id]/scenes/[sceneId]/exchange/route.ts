// src/app/api/campaigns/[id]/scenes/[sceneId]/exchange/route.ts
// Phase 16: Exchange management endpoints

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { ExchangeManager, ActionPriority } from '@/lib/game/exchange-manager'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/campaigns/[id]/scenes/[sceneId]/exchange
 * Get current exchange status and summary
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; sceneId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, sceneId } = params

    // Verify user has access to this campaign
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.id,
          campaignId
        }
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Not a campaign member' }, { status: 403 })
    }

    const exchangeManager = new ExchangeManager(campaignId, sceneId)
    const summary = await exchangeManager.getExchangeSummary()

    // Get actions organized by priority
    const actionsByPriority = await exchangeManager.getActionsByPriority()

    return NextResponse.json({
      success: true,
      exchange: summary,
      actionsByPriority: {
        immediateCombat: actionsByPriority[ActionPriority.IMMEDIATE_COMBAT],
        movement: actionsByPriority[ActionPriority.MOVEMENT],
        social: actionsByPriority[ActionPriority.SOCIAL],
        other: actionsByPriority[ActionPriority.OTHER]
      }
    })
  } catch (error) {
    console.error('Error getting exchange status:', error)
    return NextResponse.json(
      { error: 'Failed to get exchange status' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/campaigns/[id]/scenes/[sceneId]/exchange
 * Initialize a new exchange or record an action in current exchange
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; sceneId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, sceneId } = params
    const body = await request.json()

    // Verify user has access to this campaign
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.id,
          campaignId
        }
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Not a campaign member' }, { status: 403 })
    }

    const exchangeManager = new ExchangeManager(campaignId, sceneId)

    // Handle different actions
    if (body.action === 'initialize') {
      const exchangeState = await exchangeManager.initializeExchange()
      return NextResponse.json({
        success: true,
        exchange: exchangeState
      })
    }

    if (body.action === 'recordAction') {
      const { characterId, actionId } = body

      if (!characterId || !actionId) {
        return NextResponse.json(
          { error: 'Missing characterId or actionId' },
          { status: 400 }
        )
      }

      // Verify the character belongs to the user
      const character = await prisma.character.findUnique({
        where: { id: characterId }
      })

      if (!character || character.userId !== user.id) {
        return NextResponse.json(
          { error: 'Character not found or not owned by user' },
          { status: 403 }
        )
      }

      const exchangeState = await exchangeManager.recordAction(characterId, actionId)
      return NextResponse.json({
        success: true,
        exchange: exchangeState
      })
    }

    if (body.action === 'complete') {
      // Only GMs can force complete an exchange
      if (membership.role !== 'ADMIN') {
        return NextResponse.json(
          { error: 'Only GMs can force complete exchanges' },
          { status: 403 }
        )
      }

      await exchangeManager.completeExchange()
      return NextResponse.json({
        success: true,
        message: 'Exchange completed'
      })
    }

    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Error managing exchange:', error)
    return NextResponse.json(
      { error: 'Failed to manage exchange' },
      { status: 500 }
    )
  }
}
