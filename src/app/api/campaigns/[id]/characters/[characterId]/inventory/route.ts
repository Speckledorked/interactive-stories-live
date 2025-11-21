// src/app/api/campaigns/[id]/characters/[characterId]/inventory/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import {
  addItemToInventory,
  removeItemFromInventory,
  CharacterInventory,
  InventoryItem
} from '@/lib/game/inventory'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; characterId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const { characterId } = params
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

    // Only owner or admin can modify inventory
    if (character.userId !== user.userId && membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'You can only modify your own character inventory' },
        { status: 403 }
      )
    }

    let updatedInventory: CharacterInventory

    const { operation, item, inventory } = body

    if (operation === 'set' && inventory) {
      // Direct set
      updatedInventory = inventory as CharacterInventory
    } else if (operation === 'add' && item) {
      // Add item
      updatedInventory = addItemToInventory(
        character.inventory as any,
        item as InventoryItem
      )
    } else if (operation === 'remove' && item) {
      // Remove item
      updatedInventory = removeItemFromInventory(
        character.inventory as any,
        item.id,
        item.quantity || 1
      )
    } else {
      return NextResponse.json(
        { error: 'Invalid operation or missing parameters' },
        { status: 400 }
      )
    }

    // Update character
    const updated = await prisma.character.update({
      where: { id: characterId },
      data: { inventory: updatedInventory as any },
    })

    return NextResponse.json({
      character: updated,
      inventory: updatedInventory
    })
  } catch (error) {
    console.error('Update inventory error:', error)
    return NextResponse.json(
      { error: 'Failed to update inventory' },
      { status: 500 }
    )
  }
}
