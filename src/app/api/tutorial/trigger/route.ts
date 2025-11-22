import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { TutorialService } from '@/lib/tutorial/tutorial-service'

/**
 * POST /api/tutorial/trigger
 * Trigger a tutorial event (e.g., 'shortcuts_viewed', 'character_created')
 */
export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request)
    const { trigger, metadata } = await request.json()

    if (!trigger) {
      return NextResponse.json(
        { error: 'Trigger type is required' },
        { status: 400 }
      )
    }

    // Handle the trigger event
    await TutorialService.handleTriggerEvent(user.userId, trigger, metadata)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Tutorial trigger error:', error)
    return NextResponse.json(
      { error: 'Failed to process tutorial trigger' },
      { status: 500 }
    )
  }
}
