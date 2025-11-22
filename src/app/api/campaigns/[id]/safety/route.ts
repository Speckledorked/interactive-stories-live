import { NextRequest, NextResponse } from 'next/server';
import { SafetyService } from '@/lib/safety/safety-service';
import { verifyAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';

/**
 * GET /api/campaigns/[id]/safety
 * Get campaign safety settings
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: campaignId } = params;

    // Verify user has access
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    });

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const settings = await SafetyService.getCampaignSafety(campaignId);
    return NextResponse.json(settings);
  } catch (error: any) {
    console.error('Error fetching safety settings:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT /api/campaigns/[id]/safety
 * Update campaign safety settings (GM only)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: campaignId } = params;

    // Verify user is GM
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    });

    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden - GM only' }, { status: 403 });
    }

    const body = await request.json();
    const settings = await SafetyService.updateSafetySettings(campaignId, body);

    return NextResponse.json(settings);
  } catch (error: any) {
    console.error('Error updating safety settings:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
