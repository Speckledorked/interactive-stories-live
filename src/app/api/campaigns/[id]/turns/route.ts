// src/app/api/campaigns/[id]/turns/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { TurnTracker } from '@/lib/notifications/turn-tracker';
import { pusherServer } from '@/lib/pusher';

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
        // Skipping someone ELSE'S turn stays host-only — it's the one
        // turn-order control that overrides another player rather than
        // driving your own participation, i.e. moderation, not GM-ing.
        if (membership.role !== 'ADMIN') {
          return NextResponse.json({ error: 'Only the campaign host can skip another player\'s turn' }, { status: 403 });
        }
        result = await TurnTracker.skipTurn(params.id, sceneId, 'Skipped by the host');
        break;
    }

    // Broadcast the fresh turn state so every connected client's turn
    // tracker updates live, the same real-time pattern action:created and
    // the other campaign channel events already use — without this, a
    // player only sees whose turn it is after reloading the page.
    try {
      const freshTurnInfo = await TurnTracker.getCurrentTurn(params.id, sceneId);
      await pusherServer.trigger(`campaign-${params.id}`, 'turn-update', freshTurnInfo);
    } catch (pusherError) {
      console.error('Failed to broadcast turn update (non-critical):', pusherError);
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

    // Any member can end turn tracking, matching who can enable it —
    // turn order is an advisory table-level convention, not a GM power
    // (there is no human GM in this product; every human is a player).
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        userId: user.userId,
        campaignId: params.id,
      },
    });

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 });
    }

    await TurnTracker.endScene(params.id, sceneId);

    // Null payload tells every connected client's turn tracker there's
    // nothing to show anymore — see the POST handler's broadcast above.
    try {
      await pusherServer.trigger(`campaign-${params.id}`, 'turn-update', null);
    } catch (pusherError) {
      console.error('Failed to broadcast turn end (non-critical):', pusherError);
    }

    return NextResponse.json({ message: 'Turn tracking ended for scene' });

  } catch (error) {
    console.error('Error ending turn tracking:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
