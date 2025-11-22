// src/app/api/templates/route.ts
// Phase 18: Campaign template endpoints

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { CAMPAIGN_TEMPLATES, getTemplate, applyCampaignTemplate } from '@/lib/templates/campaign-templates'

/**
 * GET /api/templates
 * List all available campaign templates
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Return template list with basic info
    const templates = CAMPAIGN_TEMPLATES.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      universe: t.universe,
      tags: t.tags,
      moveCount: t.defaultMoves.length,
      factionCount: t.factionTemplates.length,
      itemCount: t.startingItems.length
    }))

    return NextResponse.json({
      success: true,
      templates
    })
  } catch (error) {
    console.error('Error fetching templates:', error)
    return NextResponse.json(
      { error: 'Failed to fetch templates' },
      { status: 500 }
    )
  }
}
