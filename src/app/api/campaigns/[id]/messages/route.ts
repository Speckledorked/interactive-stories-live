// src/app/api/campaigns/[id]/messages/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';

// GET /api/campaigns/[id]/messages - Get messages for campaign
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
    const sceneId = searchParams.get('sceneId');
    const messageType = searchParams.get('type');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Verify user is member of campaign
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        userId: user.id,
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
        // Public messages (not whispers)
        { targetUserId: null },
        // Whispers to this user
        { targetUserId: user.id },
        // Whispers from this user
        { authorId: user.id }
      ]
    };

    if (sceneId) {
      where.sceneId = sceneId;
    }

    if (messageType) {
      where.type = messageType;
    }

    const messages = await prisma.message.findMany({
      where,
      include: {
        author: {
          select: { id: true, email: true, name: true }
        },
        targetUser: {
          select: { id: true, email: true, name: true }
        },
        character: {
          select: { id: true, name: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return NextResponse.json({
      messages: messages.reverse(), // Reverse to show oldest first
      hasMore: messages.length === limit
    });

  } catch (error) {
    console.error('Error fetching messages:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/campaigns/[id]/messages - Send new message
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
    const { content, type, sceneId, targetUserId, characterId } = body;

    // Validate required fields
    if (!content?.trim()) {
      return NextResponse.json({ error: 'Message content is required' }, { status: 400 });
    }

    if (!['IN_CHARACTER', 'OUT_OF_CHARACTER', 'WHISPER', 'SYSTEM'].includes(type)) {
      return NextResponse.json({ error: 'Invalid message type' }, { status: 400 });
    }

    // Verify user is member of campaign
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        userId: user.id,
        campaignId: params.id,
      },
    });

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 });
    }

    // If whisper, validate target user is in campaign
    if (type === 'WHISPER' && targetUserId) {
      const targetMembership = await prisma.campaignMembership.findFirst({
        where: {
          userId: targetUserId,
          campaignId: params.id,
        },
      });

      if (!targetMembership) {
        return NextResponse.json({ error: 'Target user is not in this campaign' }, { status: 400 });
      }
    }

    // If IC message, validate character belongs to user
    if (type === 'IN_CHARACTER' && characterId) {
      const character = await prisma.character.findFirst({
        where: {
          id: characterId,
          userId: user.id,
          campaignId: params.id,
        },
      });

      if (!character) {
        return NextResponse.json({ error: 'Character not found or not owned by user' }, { status: 400 });
      }
    }

    // Create message
    const message = await prisma.message.create({
      data: {
        content: content.trim(),
        type,
        authorId: user.id,
        campaignId: params.id,
        sceneId: sceneId || null,
        targetUserId: type === 'WHISPER' ? targetUserId : null,
        characterId: type === 'IN_CHARACTER' ? characterId : null,
      },
      include: {
        author: {
          select: { id: true, email: true, name: true }
        },
        targetUser: {
          select: { id: true, email: true, name: true }
        },
        character: {
          select: { id: true, name: true }
        }
      },
    });

    return NextResponse.json(message);

  } catch (error) {
    console.error('Error sending message:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
