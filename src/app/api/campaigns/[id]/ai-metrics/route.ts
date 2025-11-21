// src/app/api/campaigns/[id]/ai-metrics/route.ts
// Phase 15.5.1: AI Cost & Performance Metrics API

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { AICostTracker } from '@/lib/ai/cost-tracker'
import { aiResponseCache } from '@/lib/ai/response-cache'
import { circuitBreakerManager } from '@/lib/ai/circuit-breaker'

/**
 * GET /api/campaigns/[id]/ai-metrics
 * Get AI usage metrics and costs for a campaign
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id

    // Verify user is a member of this campaign
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: session.user.id,
          campaignId
        }
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    // Get AI cost metrics
    const costTracker = new AICostTracker(campaignId)
    const metrics = await costTracker.getMetrics()

    // Get cache statistics
    const cacheStats = aiResponseCache.getStats()

    // Get circuit breaker state
    const circuitBreaker = circuitBreakerManager.getBreaker(campaignId)
    const circuitState = {
      state: circuitBreaker.getState(),
      failureCount: circuitBreaker.getFailureCount()
    }

    // Get detailed AI health data
    const worldMeta = await prisma.worldMeta.findUnique({
      where: { campaignId },
      select: {
        aiHealth: true,
        aiMetrics: true
      }
    })

    return NextResponse.json({
      metrics,
      cache: cacheStats,
      circuitBreaker: circuitState,
      aiHealth: worldMeta?.aiHealth,
      detailedMetrics: worldMeta?.aiMetrics
    })

  } catch (error) {
    console.error('Error fetching AI metrics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch AI metrics' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/campaigns/[id]/ai-metrics/cache
 * Clear the AI response cache (admin only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id

    // Verify user is an admin
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: session.user.id,
          campaignId
        }
      }
    })

    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Clear cache
    aiResponseCache.clear()

    // Reset circuit breaker if needed
    const { reset } = await request.json().catch(() => ({ reset: false }))
    if (reset) {
      circuitBreakerManager.resetBreaker(campaignId)
    }

    return NextResponse.json({
      success: true,
      message: 'Cache cleared successfully'
    })

  } catch (error) {
    console.error('Error clearing cache:', error)
    return NextResponse.json(
      { error: 'Failed to clear cache' },
      { status: 500 }
    )
  }
}
