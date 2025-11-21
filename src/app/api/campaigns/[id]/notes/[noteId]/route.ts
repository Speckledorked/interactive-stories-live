// src/app/api/campaigns/[id]/notes/[noteId]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';

// GET /api/campaigns/[id]/notes/[noteId] - Get specific note
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; noteId: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user is member of campaign
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        userId: user.userId,
        campaignId: params.id,
      },
    });

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 });
    }

    const note = await prisma.playerNote.findFirst({
      where: {
        id: params.noteId,
        campaignId: params.id,
        OR: [
          // Own private notes
          { authorId: user.userId, visibility: 'PRIVATE' },
          // Shared notes
          { visibility: 'SHARED' },
          // GM notes
          { visibility: 'GM' }
        ]
      },
      include: {
        author: {
          select: { id: true, email: true, name: true }
        },
        character: {
          select: { id: true, name: true }
        },
        npc: {
          select: { id: true, name: true }
        },
        faction: {
          select: { id: true, name: true }
        },
        scene: {
          select: { id: true }
        }
      },
    });

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    return NextResponse.json(note);

  } catch (error) {
    console.error('Error fetching note:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/campaigns/[id]/notes/[noteId] - Update note
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; noteId: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { 
      title, 
      content, 
      visibility,
      characterId,
      npcId,
      factionId,
      sceneId 
    } = body;

    // Verify user is member of campaign and owns the note
    const existingNote = await prisma.playerNote.findFirst({
      where: {
        id: params.noteId,
        campaignId: params.id,
        authorId: user.userId, // Only author can edit
      },
    });

    if (!existingNote) {
      return NextResponse.json({ error: 'Note not found or not owned by user' }, { status: 404 });
    }

    // Validate fields if provided
    if (title && !title.trim()) {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
    }

    if (content && !content.trim()) {
      return NextResponse.json({ error: 'Content cannot be empty' }, { status: 400 });
    }

    if (visibility && !['PRIVATE', 'GM', 'SHARED'].includes(visibility)) {
      return NextResponse.json({ error: 'Invalid visibility' }, { status: 400 });
    }

    // Validate entity references if provided
    if (characterId) {
      const character = await prisma.character.findFirst({
        where: { id: characterId, campaignId: params.id }
      });
      if (!character) {
        return NextResponse.json({ error: 'Character not found' }, { status: 400 });
      }
    }

    if (npcId) {
      const npc = await prisma.nPC.findFirst({
        where: { id: npcId, campaignId: params.id }
      });
      if (!npc) {
        return NextResponse.json({ error: 'NPC not found' }, { status: 400 });
      }
    }

    if (factionId) {
      const faction = await prisma.faction.findFirst({
        where: { id: factionId, campaignId: params.id }
      });
      if (!faction) {
        return NextResponse.json({ error: 'Faction not found' }, { status: 400 });
      }
    }

    if (sceneId) {
      const scene = await prisma.scene.findFirst({
        where: { id: sceneId, campaignId: params.id }
      });
      if (!scene) {
        return NextResponse.json({ error: 'Scene not found' }, { status: 400 });
      }
    }

    // Update note
    const updateData: any = {};
    if (title !== undefined) updateData.title = title.trim();
    if (content !== undefined) updateData.content = content.trim();
    if (visibility !== undefined) updateData.visibility = visibility;
    if (characterId !== undefined) updateData.characterId = characterId;
    if (npcId !== undefined) updateData.npcId = npcId;
    if (factionId !== undefined) updateData.factionId = factionId;
    if (sceneId !== undefined) updateData.sceneId = sceneId;

    const updatedNote = await prisma.playerNote.update({
      where: { id: params.noteId },
      data: updateData,
      include: {
        author: {
          select: { id: true, email: true, name: true }
        },
        character: {
          select: { id: true, name: true }
        },
        npc: {
          select: { id: true, name: true }
        },
        faction: {
          select: { id: true, name: true }
        },
        scene: {
          select: { id: true }
        }
      },
    });

    return NextResponse.json(updatedNote);

  } catch (error) {
    console.error('Error updating note:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/campaigns/[id]/notes/[noteId] - Delete note
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; noteId: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user is member of campaign and owns the note
    const existingNote = await prisma.playerNote.findFirst({
      where: {
        id: params.noteId,
        campaignId: params.id,
        authorId: user.userId, // Only author can delete
      },
    });

    if (!existingNote) {
      return NextResponse.json({ error: 'Note not found or not owned by user' }, { status: 404 });
    }

    await prisma.playerNote.delete({
      where: { id: params.noteId },
    });

    return NextResponse.json({ message: 'Note deleted successfully' });

  } catch (error) {
    console.error('Error deleting note:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
