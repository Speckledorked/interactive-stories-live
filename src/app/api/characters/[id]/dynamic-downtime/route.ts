// PLACE IN: src/app/api/characters/[id]/dynamic-downtime/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { AIDrivenDowntimeService } from '@/lib/downtime/ai-downtime-service'
import { z } from 'zod'

const createDynamicActivitySchema = z.object({
  description: z.string().min(1, 'Description is required'),
  campaignContext: z.any().optional()
})

const advanceTimeSchema = z.object({
  days: z.number().min(1).max(30)
})

// GET /api/characters/[id]/dynamic-downtime - Get character's dynamic activities
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const characterId = params.id
    const { searchParams } = new URL(request.url)
    const includeCompleted = searchParams.get('includeCompleted') === 'true'

    // This would use a modified service to get dynamic activities
    // For now, using the existing structure with custom type
    const activities = await prisma.downtimeActivity.findMany({
      where: { 
        characterId,
        ...(includeCompleted ? {} : { status: { not: 'COMPLETED' } })
      },
      include: {
        events: {
          orderBy: { day: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Transform to dynamic format
    const dynamicActivities = activities.map(activity => ({
      id: activity.id,
      playerDescription: activity.description, // Original player intent
      aiInterpretation: activity.costResources?.aiInterpretation || {
        summary: activity.name,
        estimatedDuration: activity.durationDays,
        costs: { gold: activity.costGold },
        requirements: [],
        skillsInvolved: [],
        riskLevel: 'medium',
        potentialOutcomes: []
      },
      progressDays: activity.progressDays,
      status: activity.status.toLowerCase(),
      events: activity.events.map(event => ({
        id: event.id,
        day: event.day,
        title: event.title,
        description: event.description,
        choices: event.outcomes?.choices || [],
        playerResponse: event.playerResponse,
        aiResponse: event.outcomes?.aiResponse,
        resolvedAt: event.resolvedAt
      })),
      outcomes: activity.outcomes,
      createdAt: activity.createdAt,
      completedAt: activity.completedAt
    }))

    return NextResponse.json(dynamicActivities)
  } catch (error) {
    console.error('Error fetching dynamic downtime activities:', error)
    return NextResponse.json(
      { error: 'Failed to fetch activities' },
      { status: 500 }
    )
  }
}

// POST /api/characters/[id]/dynamic-downtime - Create new dynamic activity
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const characterId = params.id
    const body = await request.json()
    const { description, campaignContext } = createDynamicActivitySchema.parse(body)

    // Use AI to interpret the activity
    const activity = await AIDrivenDowntimeService.createDynamicActivity(
      characterId,
      description,
      campaignContext
    )

    return NextResponse.json({
      success: true,
      activity
    }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error creating dynamic activity:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create activity' },
      { status: 500 }
    )
  }
}

// PUT /api/characters/[id]/dynamic-downtime - Advance time with AI processing
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const characterId = params.id
    const body = await request.json()
    const { days } = advanceTimeSchema.parse(body)

    const results = await AIDrivenDowntimeService.advanceDynamicDowntime(characterId, days)

    return NextResponse.json({
      success: true,
      daysAdvanced: days,
      results
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error advancing dynamic downtime:', error)
    return NextResponse.json(
      { error: 'Failed to advance time' },
      { status: 500 }
    )
  }
}
