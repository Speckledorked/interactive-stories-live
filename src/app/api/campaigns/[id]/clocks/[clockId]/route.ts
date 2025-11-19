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
    const user = await getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, clockId } = params
    const body = await request.json()

    // Check if user is admin
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.id,
          campaignId,
        },
      },
    })

    if (!membership || membership.role !== 'admin') {
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
        segments: body.segments,
        filled: body.filled,
        category: body.category,
        isHidden: body.isHidden,
        triggersAt: body.triggersAt,
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
          filled: clock.filled,
          segments: clock.segments,
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
    const user = await getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, clockId } = params
    const { action } = await request.json() // action: 'tick' or 'untick'

    // Check if user is admin
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.id,
          campaignId,
        },
      },
    })

    if (!membership || membership.role !== 'admin') {
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

    // Calculate new filled value
    let newFilled = currentClock.filled
    if (action === 'tick' && newFilled < currentClock.segments) {
      newFilled++
    } else if (action === 'untick' && newFilled > 0) {
      newFilled--
    }

    // Update clock
    const clock = await prisma.clock.update({
      where: { id: clockId },
      data: { filled: newFilled },
    })

    // Broadcast clock update if not hidden
    if (!clock.isHidden) {
      await pusherServer.trigger(
        `campaign-${campaignId}`,
        'clock:ticked',
        {
          clockId: clock.id,
          name: clock.name,
          filled: clock.filled,
          segments: clock.segments,
          action,
        }
      )
    }

    // Check if clock triggers
    if (clock.triggersAt && clock.filled >= clock.triggersAt) {
      // Could trigger an event here
      console.log(`Clock ${clock.name} triggered!`)
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
