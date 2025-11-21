import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/campaigns/[id]/members - List all members
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request);
    const campaignId = params.id;

    // Check if user has access to this campaign
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    });

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 });
    }

    // Get all members with their details
    const memberships = await prisma.campaignMembership.findMany({
      where: { campaignId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            createdAt: true,
          },
        },
      },
      orderBy: [
        { role: 'asc' }, // ADMIN first
        { joinedAt: 'asc' },
      ],
    });

    // Get character counts for each user in this campaign
    const characterCounts = await Promise.all(
      memberships.map(async (membership) => {
        const count = await prisma.character.count({
          where: {
            userId: membership.userId,
            campaignId,
          },
        });
        return { userId: membership.userId, count };
      })
    );

    // Combine memberships with character counts
    const members = memberships.map((membership) => ({
      ...membership,
      _count: {
        characters: characterCounts.find((c) => c.userId === membership.userId)?.count || 0,
      },
    }));

    return NextResponse.json({ members });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Error fetching members:', error);
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
  }
}
