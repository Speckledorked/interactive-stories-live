// src/app/api/campaigns/[id]/typing/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { triggerUserTyping } from '@/lib/realtime/pusher-server';

// POST /api/campaigns/[id]/typing - Send typing indicator
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
    const { isTyping } = body;

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

    // Trigger typing indicator
    await triggerUserTyping(
      params.id, 
      user.id, 
      user.name || user.email,
      Boolean(isTyping)
    );

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error sending typing indicator:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
