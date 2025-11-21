// src/app/api/campaigns/[id]/notes/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';

// GET /api/campaigns/[id]/notes - Get notes for campaign
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const visibility = searchParams.get('visibility');
    const entityType = searchParams.get('entityType'); // character, npc, faction, scene
    const entityId = searchParams.get('entityId');

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

    // Build where clause
    const where: any = {
      campaignId: params.id,
      OR: [
        // Own private notes
        { authorId: user.userId, visibility: 'PRIVATE' },
        // Shared notes
        { visibility: 'SHARED' },
        // GM notes (in AI-only system, these would be system-generated)
        { visibility: 'GM' }
      ]
    };

    if (visibility) {
      where.visibility = visibility;
      // If filtering by specific visibility, remove OR clause
      delete where.OR;
    }

    // Filter by entity type and ID
    if (entityType && entityId) {
      switch (entityType) {
        case 'character':
          where.characterId = entityId;
          break;
        case 'npc':
          where.npcId = entityId;
          break;
        case 'faction':
          where.factionId = entityId;
          break;
        case 'scene':
          where.sceneId = entityId;
          break;
      }
    }

    const notes = await prisma.playerNote.findMany({
      where,
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
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({ notes });

  } catch (error) {
    console.error('Error fetching notes:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/campaigns/[id]/notes - Create new note
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
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
      visibility = 'PRIVATE',
      characterId,
      npcId,
      factionId,
      sceneId 
    } = body;

    // Validate required fields
    if (!title?.trim() || !content?.trim()) {
      return NextResponse.json({ error: 'Title and content are required' }, { status: 400 });
    }

    if (!['PRIVATE', 'GM', 'SHARED'].includes(visibility)) {
      return NextResponse.json({ error: 'Invalid visibility' }, { status: 400 });
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

    // Create note
    const note = await prisma.playerNote.create({
      data: {
        title: title.trim(),
        content: content.trim(),
        visibility,
        authorId: user.userId,
        campaignId: params.id,
        characterId: characterId || null,
        npcId: npcId || null,
        factionId: factionId || null,
        sceneId: sceneId || null,
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

    return NextResponse.json(note);

  } catch (error) {
    console.error('Error creating note:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
