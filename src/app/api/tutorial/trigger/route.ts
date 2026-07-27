import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { TutorialService } from '@/lib/tutorial/tutorial-service'
import { handleRouteError } from '@/lib/api/errors'

/**
 * POST /api/tutorial/trigger
 * Trigger a tutorial event (e.g., 'shortcuts_viewed', 'character_created')
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request)
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
    // Called-out fix, not a silent behavior change: this route previously
    // had no Unauthorized special-case, so an unauthenticated request fell
    // through to a bare 500 instead of 401 like every other requireAuth
    // route. Bringing it in line with the shared helper.
    return handleRouteError(error, 'Tutorial trigger error', 'Failed to process tutorial trigger')
  }
}
