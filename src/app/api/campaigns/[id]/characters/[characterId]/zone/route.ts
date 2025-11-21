// src/app/api/campaigns/[id]/characters/[characterId]/zone/route.ts
// Phase 16: Zone-based positioning management

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { ZoneManager, ZonePosition } from '@/lib/game/exchange-manager'
import { prisma } from '@/lib/prisma'

/**
 * PUT /api/campaigns/[id]/characters/[characterId]/zone
 * Update a character's zone position
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; characterId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, characterId } = params
    const body = await request.json()
    const { zone } = body

    if (!zone) {
      return NextResponse.json(
        { error: 'Missing zone parameter' },
        { status: 400 }
      )
    }

    const validZones: ZonePosition[] = ['close', 'near', 'far', 'distant']
    if (!validZones.includes(zone)) {
      return NextResponse.json(
        { error: 'Invalid zone. Must be: close, near, far, or distant' },
        { status: 400 }
      )
    }

    // Verify user has access to this campaign
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.id,
          campaignId
        }
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Not a campaign member' }, { status: 403 })
    }

    // Verify the character belongs to the user or user is GM
    const character = await prisma.character.findUnique({
      where: { id: characterId }
    })

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    if (character.userId !== user.id && membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Can only update your own character zone' },
        { status: 403 }
      )
    }

    await ZoneManager.updateCharacterZone(characterId, zone)

    return NextResponse.json({
      success: true,
      characterId,
      zone
    })
  } catch (error) {
    console.error('Error updating character zone:', error)
    return NextResponse.json(
      { error: 'Failed to update character zone' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/campaigns/[id]/characters/[characterId]/zone
 * Get a character's current zone position
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; characterId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, characterId } = params

    // Verify user has access to this campaign
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.id,
          campaignId
        }
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Not a campaign member' }, { status: 403 })
    }

    const character = await prisma.character.findUnique({
      where: { id: characterId },
      select: {
        id: true,
        name: true,
        currentZone: true,
        zoneMetadata: true
      }
    })

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      character: {
        id: character.id,
        name: character.name,
        zone: character.currentZone || 'near',
        metadata: character.zoneMetadata
      }
    })
  } catch (error) {
    console.error('Error getting character zone:', error)
    return NextResponse.json(
      { error: 'Failed to get character zone' },
      { status: 500 }
    )
  }
}
