import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/campaigns/[id]/wiki - Get wiki entries
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
    const { searchParams } = new URL(request.url)
    const entryType = searchParams.get('type')

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

    const whereClause: any = { campaignId }
    if (entryType) {
      whereClause.entryType = entryType
    }

    const entries = await prisma.wikiEntry.findMany({
      where: whereClause,
      orderBy: [
        { importance: 'desc' },
        { name: 'asc' }
      ]
    })

    return NextResponse.json({ entries })
  } catch (error) {
    console.error('Error fetching wiki entries:', error)
    return NextResponse.json({ error: 'Failed to fetch wiki entries' }, { status: 500 })
  }
}

// POST /api/campaigns/[id]/wiki - Create a wiki entry
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

    // Verify user is admin of the campaign (only admins/AI can create entries)
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        campaignId,
        userId: user.userId,
        role: 'ADMIN'
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Only campaign admins can create wiki entries' }, { status: 403 })
    }

    const body = await request.json()
    const {
      entryType,
      name,
      summary,
      description,
      tags,
      aliases,
      imageUrl,
      importance,
      lastSeenTurn
    } = body

    const entry = await prisma.wikiEntry.create({
      data: {
        campaignId,
        entryType,
        name,
        summary,
        description,
        tags: tags || [],
        aliases: aliases || [],
        imageUrl,
        importance: importance || 'normal',
        lastSeenTurn,
        createdBy: 'ai'
      }
    })

    return NextResponse.json({ entry }, { status: 201 })
  } catch (error) {
    console.error('Error creating wiki entry:', error)
    return NextResponse.json({ error: 'Failed to create wiki entry' }, { status: 500 })
  }
}
