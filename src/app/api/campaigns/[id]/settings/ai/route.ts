// src/app/api/campaigns/[id]/settings/ai/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
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
        { error: 'Only campaign admins can update settings' },
        { status: 403 }
      )
    }

    // Update AI settings
    const campaign = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        aiSystemPrompt: body.aiSystemPrompt,
        initialWorldSeed: body.initialWorldSeed,
      },
      select: {
        id: true,
        aiSystemPrompt: true,
        initialWorldSeed: true,
      },
    })

    return NextResponse.json({ campaign })
  } catch (error) {
    console.error('Update AI settings error:', error)
    return NextResponse.json(
      { error: 'Failed to update AI settings' },
      { status: 500 }
    )
  }
}
