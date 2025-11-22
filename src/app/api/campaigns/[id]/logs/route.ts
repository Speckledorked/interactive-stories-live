import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/campaigns/[id]/logs - Get campaign story log
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = verifyToken(token)
    if (!user) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const campaignId = params.id

    // Verify user is a member of the campaign
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        campaignId,
        userId: user.userId
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const logs = await prisma.campaignLog.findMany({
      where: { campaignId },
      orderBy: { turnNumber: 'asc' }
    })

    return NextResponse.json({ logs })
  } catch (error) {
    console.error('Error fetching campaign logs:', error)
    return NextResponse.json({ error: 'Failed to fetch campaign logs' }, { status: 500 })
  }
}

// POST /api/campaigns/[id]/logs - Create a campaign log entry
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = verifyToken(token)
    if (!user) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const campaignId = params.id

    // Verify user is admin of the campaign (only admins/AI can create logs)
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        campaignId,
        userId: user.userId,
        role: 'ADMIN'
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Only campaign admins can create log entries' }, { status: 403 })
    }

    const body = await request.json()
    const { sceneId, turnNumber, title, summary, highlights, entryType, inGameDate, duration } = body

    const log = await prisma.campaignLog.create({
      data: {
        campaignId,
        sceneId,
        turnNumber,
        title,
        summary,
        highlights: highlights || [],
        entryType: entryType || 'scene',
        inGameDate,
        duration
      }
    })

    return NextResponse.json({ log }, { status: 201 })
  } catch (error) {
    console.error('Error creating campaign log:', error)
    return NextResponse.json({ error: 'Failed to create campaign log' }, { status: 500 })
  }
}
