import { NextRequest, NextResponse } from 'next/server';
import { CampaignExporter } from '@/lib/export/campaign-exporter';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/campaigns/[id]/export
 * Export campaign data as JSON
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

    // Parse query parameters for export options
    const searchParams = request.nextUrl.searchParams;
    const includeCharacters = searchParams.get('characters') !== 'false';
    const includeScenes = searchParams.get('scenes') !== 'false';
    const includeSessions = searchParams.get('sessions') !== 'false';
    const includeTimeline = searchParams.get('timeline') !== 'false';
    const includeMessages = searchParams.get('messages') !== 'false';
    const includeNotes = searchParams.get('notes') !== 'false';
    const includeNPCs = searchParams.get('npcs') !== 'false';
    const includeFactions = searchParams.get('factions') !== 'false';
    const includeClocks = searchParams.get('clocks') !== 'false';
    const includeMoves = searchParams.get('moves') !== 'false';
    const includeWorldMeta = searchParams.get('worldMeta') !== 'false';

    const exportData = await CampaignExporter.exportCampaign(campaignId, {
      includeCharacters,
      includeScenes,
      includeSessions,
      includeTimeline,
      includeMessages,
      includeNotes,
      includeNPCs,
      includeFactions,
      includeClocks,
      includeMoves,
      includeWorldMeta,
    });

    // Return as downloadable JSON file
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    const filename = `${campaign?.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_export_${new Date().toISOString().split('T')[0]}.json`;

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error('Error exporting campaign:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
