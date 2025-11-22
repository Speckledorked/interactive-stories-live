import { NextRequest, NextResponse } from 'next/server';
import { CampaignExporter } from '@/lib/export/campaign-exporter';
import { verifyAuth } from '@/lib/auth';

/**
 * POST /api/campaigns/import
 * Import campaign from JSON export
 */
export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { exportData, newTitle } = body;

    if (!exportData) {
      return NextResponse.json({ error: 'Missing export data' }, { status: 400 });
    }

    const newCampaign = await CampaignExporter.importCampaign(
      exportData,
      user.userId,
      newTitle
    );

    return NextResponse.json(newCampaign);
  } catch (error: any) {
    console.error('Error importing campaign:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
