import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';
import { getCampaignMembership, requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { handleRouteError } from '@/lib/api/errors';
import { TurnTracker, type TurnOrder } from '@/lib/notifications/turn-tracker';

// DELETE /api/campaigns/[id]/members/[userId] - Remove member from campaign
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  try {
    const user = await requireAuth(request);
    const campaignId = params.id;
    const targetUserId = params.userId;

    // Check if current user is an admin
    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only admins can remove members');
    if ('response' in adminCheck) return adminCheck.response;

    // Check if target user is a member
    const targetMembership = await getCampaignMembership(targetUserId, campaignId);

    if (!targetMembership) {
      return NextResponse.json({ error: 'This user is not a member of this campaign' }, { status: 403 });
    }

    // Prevent removing the last admin
    if (targetMembership.role === UserRole.ADMIN) {
      const adminCount = await prisma.campaignMembership.count({
        where: {
          campaignId,
          role: UserRole.ADMIN,
        },
      });

      if (adminCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot remove the last admin from the campaign' },
          { status: 400 }
        );
      }
    }

    // Delete the membership (cascade will handle characters)
    await prisma.campaignMembership.delete({
      where: {
        userId_campaignId: {
          userId: targetUserId,
          campaignId,
        },
      },
    });

    // Drop the removed member from any scene's stored turnOrder they're
    // still present in — otherwise the queue stalls on their slot every
    // time it comes back around, since getCampaignMembership already 403s
    // them out of advancing their own turn but nothing ever clears the
    // stale entry. Best-effort: a failure here shouldn't undo the removal.
    const turnTrackers = await prisma.turnTracker.findMany({
      where: { campaignId, sceneId: { not: null } },
      select: { sceneId: true, turnOrder: true },
    });
    for (const tracker of turnTrackers) {
      const turnOrder = tracker.turnOrder as unknown as TurnOrder[];
      if (tracker.sceneId && turnOrder.some(p => p.userId === targetUserId)) {
        await TurnTracker.removePlayerFromTurn(campaignId, tracker.sceneId, targetUserId).catch(err =>
          console.error('Failed to remove member from turn order:', err)
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'Error removing member', 'Failed to remove member');
  }
}

// PATCH /api/campaigns/[id]/members/[userId] - Update member role
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  try {
    const user = await requireAuth(request);
    const campaignId = params.id;
    const targetUserId = params.userId;
    const body = await request.json();
    const { role } = body;

    // Validate role
    if (!role || !Object.values(UserRole).includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Check if current user is an admin
    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only admins can change member roles');
    if ('response' in adminCheck) return adminCheck.response;

    // Check if target user is a member
    const targetMembership = await getCampaignMembership(targetUserId, campaignId);

    if (!targetMembership) {
      return NextResponse.json({ error: 'This user is not a member of this campaign' }, { status: 403 });
    }

    // Prevent demoting the last admin
    if (targetMembership.role === UserRole.ADMIN && role === UserRole.PLAYER) {
      const adminCount = await prisma.campaignMembership.count({
        where: {
          campaignId,
          role: UserRole.ADMIN,
        },
      });

      if (adminCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot demote the last admin' },
          { status: 400 }
        );
      }
    }

    // Update the role
    const updatedMembership = await prisma.campaignMembership.update({
      where: {
        userId_campaignId: {
          userId: targetUserId,
          campaignId,
        },
      },
      data: { role },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return NextResponse.json({ membership: updatedMembership });
  } catch (error) {
    return handleRouteError(error, 'Error updating member role', 'Failed to update member role');
  }
}
