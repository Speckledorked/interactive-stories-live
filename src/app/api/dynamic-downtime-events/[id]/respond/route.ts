// PLACE IN: src/app/api/dynamic-downtime/events/[id]/respond/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { AIDrivenDowntimeService } from '@/lib/downtime/ai-downtime-service'
import { z } from 'zod'

const respondSchema = z.object({
  response: z.string().min(1, 'Response is required'),
  campaignContext: z.any().optional()
})

// POST /api/dynamic-downtime/events/[id]/respond - Respond to dynamic event
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const eventId = params.id
    const body = await request.json()
    const { response, campaignContext } = respondSchema.parse(body)

    const result = await AIDrivenDowntimeService.respondToDynamicEvent(
      eventId,
      response,
      campaignContext
    )

    return NextResponse.json({
      success: true,
      ...result
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error responding to dynamic event:', error)
    return NextResponse.json(
      { error: 'Failed to respond to event' },
      { status: 500 }
    )
  }
}
