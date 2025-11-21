// src/app/api/campaigns/[id]/turns/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { TurnTracker } from '@/lib/notifications/turn-tracker';

// GET /api/campaigns/[id]/turns - Get current turn info
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

    if (!sceneId) {
      return NextResponse.json({ error: 'Scene ID required' }, { status: 400 });
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

    const turnInfo = await TurnTracker.getCurrentTurn(params.id, sceneId);
    
    return NextResponse.json({ turnInfo });

  } catch (error) {
    console.error('Error fetching turn info:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/campaigns/[id]/turns - Initialize or advance turn
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
    const { action, sceneId, participants, turnTimeoutMinutes } = body;

    if (!action || !['initialize', 'advance', 'skip'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    if (!sceneId) {
      return NextResponse.json({ error: 'Scene ID required' }, { status: 400 });
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

    let result;

    switch (action) {
      case 'initialize':
        if (!participants || !Array.isArray(participants)) {
          return NextResponse.json({ error: 'Participants required for initialization' }, { status: 400 });
        }
        result = await TurnTracker.initializeScene(
          params.id, 
          sceneId, 
          participants,
          turnTimeoutMinutes || 60
        );
        break;

      case 'advance':
        result = await TurnTracker.advanceTurn(params.id, sceneId, user.userId);
        break;

      case 'skip':
        // Only allow GMs/admins to skip turns
        if (membership.role !== 'ADMIN') {
          return NextResponse.json({ error: 'Only campaign admins can skip turns' }, { status: 403 });
        }
        result = await TurnTracker.skipTurn(params.id, sceneId, 'Skipped by GM');
        break;
    }

    return NextResponse.json({ 
      message: `Turn ${action}d successfully`,
      result 
    });

  } catch (error) {
    console.error('Error managing turn:', error);
    
    // Handle specific errors
    if (error instanceof Error) {
      if (error.message === 'Not your turn') {
        return NextResponse.json({ error: 'Not your turn' }, { status: 400 });
      }
      if (error.message === 'Turn tracker not found') {
        return NextResponse.json({ error: 'Turn tracker not found' }, { status: 404 });
      }
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/campaigns/[id]/turns - End turn tracking for scene
export async function DELETE(
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

    if (!sceneId) {
      return NextResponse.json({ error: 'Scene ID required' }, { status: 400 });
    }

    // Verify user is admin of campaign
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        userId: user.userId,
        campaignId: params.id,
        role: 'ADMIN'
      },
    });

    if (!membership) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    await TurnTracker.endScene(params.id, sceneId);

    return NextResponse.json({ message: 'Turn tracking ended for scene' });

  } catch (error) {
    console.error('Error ending turn tracking:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
