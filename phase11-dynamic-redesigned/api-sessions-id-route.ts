// PLACE IN: src/app/api/sessions/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { SessionService } from '@/lib/sessions/session-service'
import { z } from 'zod'

const startSessionSchema = z.object({
  characterIds: z.array(z.string()).min(1, 'At least one character required')
})

const endSessionSchema = z.object({
  experienceAwarded: z.number().min(0).optional(),
  goldAwarded: z.number().min(0).optional(),
  itemsAwarded: z.array(z.string()).optional(),
  notes: z.string().optional()
})

const addNoteSchema = z.object({
  content: z.string().min(1, 'Content is required'),
  noteType: z.string().optional(),
  isPublic: z.boolean().optional()
})

// POST /api/sessions/[id]/start - Start a session
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sessionId = params.id
    const { pathname } = new URL(request.url)
    
    if (pathname.endsWith('/start')) {
      // Start session
      const body = await request.json()
      const { characterIds } = startSessionSchema.parse(body)
      
      const startedSession = await SessionService.startSession(sessionId, characterIds)
      return NextResponse.json(startedSession)
      
    } else if (pathname.endsWith('/end')) {
      // End session
      const body = await request.json()
      const summary = endSessionSchema.parse(body)
      
      const endedSession = await SessionService.endSession(sessionId, summary)
      return NextResponse.json(endedSession)
      
    } else if (pathname.endsWith('/notes')) {
      // Add note
      const body = await request.json()
      const { content, noteType, isPublic } = addNoteSchema.parse(body)
      
      const note = await SessionService.addSessionNote(
        sessionId,
        session.user.id,
        content,
        noteType || 'GENERAL',
        isPublic !== false
      )
      return NextResponse.json(note)
    }

    return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error in session operation:', error)
    return NextResponse.json(
      { error: 'Failed to perform session operation' },
      { status: 500 }
    )
  }
}

// GET /api/sessions/[id] - Get session details
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // This would need to be implemented in SessionService
    // For now, redirect to campaign sessions endpoint
    return NextResponse.json({ 
      error: 'Use campaign sessions endpoint',
      message: 'GET /api/campaigns/[id]/sessions'
    }, { status: 400 })
  } catch (error) {
    console.error('Error fetching session:', error)
    return NextResponse.json(
      { error: 'Failed to fetch session' },
      { status: 500 }
    )
  }
}
