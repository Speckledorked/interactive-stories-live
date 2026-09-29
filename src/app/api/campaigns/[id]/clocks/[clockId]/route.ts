// src/app/api/campaigns/[id]/clocks/[clockId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { PusherServer } from '@/lib/realtime/pusher-server'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { validateClockTicks } from '@/lib/game/clockInvariant'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; clockId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, clockId } = params
    const body = await request.json()

    // Check if user is admin
    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can update clocks')
    if ('response' in adminCheck) return adminCheck.response

    // #480: ticks used to be written straight from the body. The tick
    // engine reads `currentTicks < maxTicks` as "advanceable" and
    // `currentTicks >= maxTicks` as "just finished", so a clock outside
    // `0 <= current <= max` (max >= 1) is one neither reading describes —
    // reachable here by a typo in a number field, and silent afterwards.
    // See lib/game/clockInvariant.ts, which is where the tick path's
    // assumption is now written down.
    const existing = await prisma.clock.findFirst({
      where: { id: clockId, campaignId },
      select: { currentTicks: true, maxTicks: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Clock not found' }, { status: 404 })
    }

    const ticks = validateClockTicks(body, existing)
    if (!ticks.ok) {
      return NextResponse.json({ error: ticks.error }, { status: 400 })
    }

    // Update Clock
    const clock = await prisma.clock.update({
      where: {
        id: clockId,
        campaignId,
      },
      data: {
        name: body.name,
        description: body.description,
        // Spread rather than assigned: an absent field must stay absent so
        // Prisma leaves the column alone, and `maxTicks: undefined` after
        // validation would be indistinguishable from "not sent".
        ...ticks.value,
        category: body.category,
        isHidden: body.isHidden,
        consequence: body.consequence,
        gmNotes: body.gmNotes,
      },
    })

    // Broadcast clock update if not hidden — best-effort, same as every
    // other real-time broadcast in this codebase: a Pusher failure must
    // never fail the write that already succeeded.
    if (!clock.isHidden) {
      try {
        const pusher = PusherServer()
        if (pusher) {
          await pusher.trigger(
            `campaign-${campaignId}`,
            'clock:updated',
            {
              clockId: clock.id,
              name: clock.name,
              currentTicks: clock.currentTicks,
              maxTicks: clock.maxTicks,
            }
          )
        }
      } catch (pusherError) {
        console.error('Failed to broadcast clock update (non-critical):', pusherError)
      }
    }

    return NextResponse.json({ clock })
  } catch (error) {
    console.error('Update clock error:', error)
    return NextResponse.json(
      { error: 'Failed to update clock' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; clockId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, clockId } = params
    const { action } = await request.json() // action: 'tick' or 'untick'

    // Check if user is admin
    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can modify clocks')
    if ('response' in adminCheck) return adminCheck.response

    // Get current clock state
    const currentClock = await prisma.clock.findUnique({
      where: { 
        id: clockId,
        campaignId,
      },
    })

    if (!currentClock) {
      return NextResponse.json(
        { error: 'Clock not found' },
        { status: 404 }
      )
    }

    // Calculate new currentTicks value
    let newCurrentTicks = currentClock.currentTicks
    if (action === 'tick' && newCurrentTicks < currentClock.maxTicks) {
      newCurrentTicks++
    } else if (action === 'untick' && newCurrentTicks > 0) {
      newCurrentTicks--
    }

    // Update clock
    const clock = await prisma.clock.update({
      where: { id: clockId },
      data: { currentTicks: newCurrentTicks },
    })

    // Broadcast clock update if not hidden — best-effort, same reasoning
    // as the PATCH handler above.
    if (!clock.isHidden) {
      try {
        const pusher = PusherServer()
        if (pusher) {
          await pusher.trigger(
            `campaign-${campaignId}`,
            'clock:ticked',
            {
              clockId: clock.id,
              name: clock.name,
              currentTicks: clock.currentTicks,
              maxTicks: clock.maxTicks,
              action,
            }
          )
        }
      } catch (pusherError) {
        console.error('Failed to broadcast clock tick (non-critical):', pusherError)
      }
    }

    // Check if clock is full
    if (clock.currentTicks >= clock.maxTicks && clock.consequence) {
      console.log(`Clock ${clock.name} triggered: ${clock.consequence}`)
    }

    return NextResponse.json({ clock })
  } catch (error) {
    console.error('Tick clock error:', error)
    return NextResponse.json(
      { error: 'Failed to update clock' },
      { status: 500 }
    )
  }
}
