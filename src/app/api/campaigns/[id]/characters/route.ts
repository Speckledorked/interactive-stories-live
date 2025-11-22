// src/app/api/campaigns/[id]/characters/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { validateStats } from '@/lib/game/advancement'

interface CreateCharacterBody {
  name: string
  pronouns?: string
  description?: string
  appearance?: string
  personality?: string
  stats?: any
  backstory?: string
  goals?: string
  currentLocation?: string
  moves?: string[]
  perks?: Array<{
    id: string
    name: string
    description: string
    tags?: string[]
  }>
  equipment?: {
    weapon?: string
    armor?: string
    misc?: string
  }
  inventory?: {
    items?: Array<{
      id: string
      name: string
      quantity: number
      tags: string[]
    }>
    slots?: number
  }
  resources?: {
    gold?: number
    contacts?: string[]
    reputation?: Record<string, number>
  }
  consequences?: {
    promises?: string[]
    debts?: string[]
    enemies?: string[]
    longTermThreats?: string[]
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const body: CreateCharacterBody = await request.json()

    if (!body.name) {
      return NextResponse.json(
        { error: 'Character name is required' },
        { status: 400 }
      )
    }

    // Validate stats if provided
    if (body.stats) {
      const validation = validateStats(body.stats as Record<string, number>)
      if (!validation.valid) {
        return NextResponse.json(
          { error: `Invalid stats: ${validation.error}` },
          { status: 400 }
        )
      }
    }

    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'You are not a member of this campaign' },
        { status: 403 }
      )
    }

    const character = await prisma.character.create({
      data: {
        campaignId,
        userId: user.userId,
        name: body.name,
        pronouns: body.pronouns,
        description: body.description,
        appearance: body.appearance,
        personality: body.personality,
        stats: body.stats,
        backstory: body.backstory,
        goals: body.goals,
        currentLocation: body.currentLocation,
        moves: body.moves || [],
        equipment: body.equipment || undefined,
        inventory: body.inventory || undefined,
        resources: body.resources || undefined,
        perks: body.perks || undefined,
        consequences: body.consequences || undefined,
      },
    })

    // Auto-create NPCs for contacts mentioned in character's backstory
    if (body.resources?.contacts && body.resources.contacts.length > 0) {
      for (const contactName of body.resources.contacts) {
        try {
          // Check if NPC already exists with this name or alias
          const existingNPC = await prisma.wikiEntry.findFirst({
            where: {
              campaignId,
              entryType: 'NPC',
              OR: [
                { name: contactName },
                { aliases: { has: contactName } }
              ]
            }
          })

          if (!existingNPC) {
            // Create stub NPC entry
            await prisma.wikiEntry.create({
              data: {
                campaignId,
                entryType: 'NPC',
                name: contactName,
                summary: `Contact of ${body.name}`,
                description: `${contactName} is a known contact of ${body.name}. More details will be revealed through gameplay.`,
                tags: ['contact', 'unmet'],
                aliases: [],
                importance: 'normal',
                createdBy: 'system'
              }
            })
            console.log(`✨ Auto-created NPC: ${contactName} (contact of ${body.name})`)
          }
        } catch (npcError) {
          // Log error but don't fail character creation
          console.error(`Failed to auto-create NPC for contact ${contactName}:`, npcError)
        }
      }
    }

    return NextResponse.json({ character })
  } catch (error) {
    console.error('Create character error:', error)
    return NextResponse.json(
      { error: 'Failed to create character' },
      { status: 500 }
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id

    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'You are not a member of this campaign' },
        { status: 403 }
      )
    }

    const characters = await prisma.character.findMany({
      where: {
        campaignId,
        isAlive: true,
      },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    return NextResponse.json({ characters })
  } catch (error) {
    console.error('Get characters error:', error)
    return NextResponse.json(
      { error: 'Failed to get characters' },
      { status: 500 }
    )
  }
}
