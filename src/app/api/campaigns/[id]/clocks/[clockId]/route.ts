// src/app/api/campaigns/[id]/clocks/[clockId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { pusherServer } from '@/lib/pusher'

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
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    })

    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only campaign admins can update clocks' },
        { status: 403 }
      )
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
        maxTicks: body.maxTicks,
        currentTicks: body.currentTicks,
        category: body.category,
        isHidden: body.isHidden,
        consequence: body.consequence,
        gmNotes: body.gmNotes,
      },
    })

    // Broadcast clock update if not hidden
    if (!clock.isHidden) {
      await pusherServer.trigger(
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
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    })

    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only campaign admins can modify clocks' },
        { status: 403 }
      )
    }

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

    // Broadcast clock update if not hidden
    if (!clock.isHidden) {
      await pusherServer.trigger(
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
