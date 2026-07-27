import { NextRequest, NextResponse } from 'next/server';
import { SafetyService } from '@/lib/safety/safety-service';
import { verifyAuth } from '@/lib/auth';
import { XCardTrigger, UserRole } from '@prisma/client';
import { getCampaignMembership } from '@/lib/db/campaignAccess'

/**
 * POST /api/campaigns/[id]/xcard
 * Use X-Card to pause/rewind content
 */
export async function POST(
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
    const membership = await getCampaignMembership(user.userId, campaignId);

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { trigger, targetId, reason, sceneId } = body;

    if (!trigger || !Object.values(XCardTrigger).includes(trigger)) {
      return NextResponse.json({ error: 'Invalid trigger' }, { status: 400 });
    }

    const xCardUse = await SafetyService.useXCard(
      campaignId,
      user.userId,
      trigger as XCardTrigger,
      targetId,
      reason,
      sceneId
    );

    return NextResponse.json(xCardUse);
  } catch (error: any) {
    console.error('Error using X-Card:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/campaigns/[id]/xcard
 * Get X-Card history (GM only)
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

    // Verify user is GM
    const membership = await getCampaignMembership(user.userId, campaignId);

    if (!membership || membership.role !== UserRole.ADMIN) {
      return NextResponse.json({ error: 'Forbidden - GM only' }, { status: 403 });
    }

    const history = await SafetyService.getXCardHistory(campaignId, true);
    return NextResponse.json(history);
  } catch (error: any) {
    console.error('Error fetching X-Card history:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
