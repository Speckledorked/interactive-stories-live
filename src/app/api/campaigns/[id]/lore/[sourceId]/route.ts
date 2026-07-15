// src/app/api/campaigns/[id]/lore/[sourceId]/route.ts
// Delete an imported lore source and everything it produced. sourceId is
// a LoreImportJob id — deleting it cascades to its LoreEntry rows
// (onDelete: Cascade in the schema), so one call removes the whole source.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; sourceId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const membership = await prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId: user.userId, campaignId } },
    })
    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only campaign admins can delete lore sources' }, { status: 403 })
    }

    const deleted = await prisma.loreImportJob.deleteMany({
      where: { id: params.sourceId, campaignId },
    })
    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Lore source not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete lore source error:', error)
    return NextResponse.json({ error: 'Failed to delete lore source' }, { status: 500 })
  }
}
