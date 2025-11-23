// src/app/api/campaigns/[id]/characters/[characterId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { validateStats } from '@/lib/game/advancement'

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

    // Check membership
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

    // Get character
    const character = await prisma.character.findUnique({
      where: { id: characterId },
    })

    if (!character) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      )
    }

    // All campaign members can view any character in the campaign
    // (Editing is still restricted to owner/admin - see PATCH handler)
    return NextResponse.json(character)
  } catch (error) {
    console.error('Get character error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch character' },
      { status: 500 }
    )
  }
}

export async function PATCH(
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

    // Check membership
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

    // Check character ownership or admin
    const character = await prisma.character.findUnique({
      where: { id: characterId },
    })

    if (!character) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      )
    }

    if (character.userId !== user.userId && membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'You can only update your own characters' },
        { status: 403 }
      )
    }

    // Validate stats if being updated
    if (body.stats) {
      const validation = validateStats(body.stats as Record<string, number>)
      if (!validation.valid) {
        return NextResponse.json(
          { error: `Invalid stats: ${validation.error}` },
          { status: 400 }
        )
      }
    }

    // Update character
    const updatedCharacter = await prisma.character.update({
      where: { id: characterId },
      data: body,
    })

    // Auto-create NPCs for any NEW contacts added
    if (body.resources?.contacts && body.resources.contacts.length > 0) {
      const oldContacts = (character.resources as any)?.contacts || []
      const newContacts = body.resources.contacts.filter(
        (contact: string) => !oldContacts.includes(contact)
      )

      for (const contactName of newContacts) {
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
                summary: `Contact of ${character.name}`,
                description: `${contactName} is a known contact of ${character.name}. More details will be revealed through gameplay.`,
                tags: ['contact', 'unmet'],
                aliases: [],
                importance: 'normal',
                createdBy: 'system'
              }
            })
            console.log(`✨ Auto-created NPC: ${contactName} (contact of ${character.name})`)
          }
        } catch (npcError) {
          // Log error but don't fail character update
          console.error(`Failed to auto-create NPC for contact ${contactName}:`, npcError)
        }
      }
    }

    return NextResponse.json({ character: updatedCharacter })
  } catch (error) {
    console.error('Update character error:', error)
    return NextResponse.json(
      { error: 'Failed to update character' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; characterId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, characterId } = params

    // Check membership
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

    // Check character ownership or admin
    const character = await prisma.character.findUnique({
      where: { id: characterId },
    })

    if (!character) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      )
    }

    if (character.userId !== user.userId && membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'You can only delete your own characters' },
        { status: 403 }
      )
    }

    // Delete the character (this will cascade delete related records)
    await prisma.character.delete({
      where: { id: characterId },
    })

    return NextResponse.json({ success: true, message: 'Character deleted successfully' })
  } catch (error) {
    console.error('Delete character error:', error)
    return NextResponse.json(
      { error: 'Failed to delete character' },
      { status: 500 }
    )
  }
}
