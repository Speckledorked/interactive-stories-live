import { NextRequest, NextResponse } from 'next/server';
import { CampaignExporter } from '@/lib/export/campaign-exporter';
import { verifyAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';

/**
 * GET /api/campaigns/[id]/export/session/[sessionId]
 * Export session transcript
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; sessionId: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: campaignId, sessionId } = params;

    // Verify user has access to this campaign
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

    const sessionData = await CampaignExporter.exportSessionTranscript(sessionId);

    // Return as downloadable text file
    const filename = `session_${sessionData.session.sessionNumber}_transcript_${new Date().toISOString().split('T')[0]}.txt`;

    return new NextResponse(sessionData.transcript, {
      headers: {
        'Content-Type': 'text/plain',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error('Error exporting session:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
