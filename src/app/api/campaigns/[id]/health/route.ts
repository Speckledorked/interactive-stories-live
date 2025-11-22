// src/app/api/campaigns/[id]/health/route.ts
// Phase 15.4: Campaign Health Monitoring API

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CampaignHealthMonitor } from '@/lib/game/campaign-health'

/**
 * GET /api/campaigns/[id]/health
 * Get campaign health status and recommendations
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)

    if (!user?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id

    // Verify user is a member of this campaign
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId
        }
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    // Calculate current health
    const healthMonitor = new CampaignHealthMonitor(campaignId)
    const health = await healthMonitor.calculateHealth()

    // Check for unwinnable scenarios
    const unwinnableCheck = await healthMonitor.detectUnwinnableScenario()

    // Get stopping point suggestions
    const stoppingPoints = await healthMonitor.suggestStoppingPoints()

    // Get historical health data
    const worldMeta = await prisma.worldMeta.findUnique({
      where: { campaignId },
      select: {
        campaignHealthHistory: true,
        lastHealthCheck: true,
        currentHealthScore: true
      }
    })

    return NextResponse.json({
      current: health,
      unwinnable: unwinnableCheck,
      stoppingPoints,
      history: worldMeta?.campaignHealthHistory || [],
      lastCheck: worldMeta?.lastHealthCheck,
      lastScore: worldMeta?.currentHealthScore
    })

  } catch (error) {
    console.error('Error fetching campaign health:', error)
    return NextResponse.json(
      { error: 'Failed to fetch campaign health' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/campaigns/[id]/health
 * Manually trigger a health check (admin only)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)

    if (!user?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id

    // Verify user is an admin of this campaign
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId
        }
      }
    })

    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Run health check
    const healthMonitor = new CampaignHealthMonitor(campaignId)
    const health = await healthMonitor.calculateHealth()
    await healthMonitor.recordHealthCheck(health)

    return NextResponse.json({
      success: true,
      health
    })

  } catch (error) {
    console.error('Error running health check:', error)
    return NextResponse.json(
      { error: 'Failed to run health check' },
      { status: 500 }
    )
  }
}
