// PLACE IN: src/app/api/campaigns/[id]/sessions/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { SessionService } from '@/lib/sessions/session-service'
import { z } from 'zod'

const createSessionSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  objectives: z.array(z.string()).optional(),
  scheduledAt: z.string().datetime().optional()
})

// GET /api/campaigns/[id]/sessions - Get campaign sessions
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
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const limit = searchParams.get('limit')
    const offset = searchParams.get('offset')

    const sessions = await SessionService.getCampaignSessions(campaignId, {
      status: status || undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined
    })

    return NextResponse.json(sessions)
  } catch (error) {
    console.error('Error fetching sessions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sessions' },
      { status: 500 }
    )
  }
}

// POST /api/campaigns/[id]/sessions - Create new session
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const body = await request.json()
    const validatedData = createSessionSchema.parse(body)

    const newSession = await SessionService.createSession(campaignId, {
      name: validatedData.name,
      description: validatedData.description,
      objectives: validatedData.objectives,
      scheduledAt: validatedData.scheduledAt ? new Date(validatedData.scheduledAt) : undefined
    })

    return NextResponse.json(newSession, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error creating session:', error)
    return NextResponse.json(
      { error: 'Failed to create session' },
      { status: 500 }
    )
  }
}
