// src/app/api/campaigns/route.ts
// Campaign management endpoints
// GET - List campaigns user belongs to
// POST - Create new campaign

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { ErrorResponse } from '@/types/api'
import { handleRouteError } from '@/lib/api/errors'
import { getTemplate } from '@/lib/templates/campaign-templates'
import { recordEvent } from '@/lib/analytics/events'
import { createCampaign, type ValidatedLoreImport } from '@/lib/game/campaignCreation'

// GET /api/campaigns - List user's campaigns
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request)

    // Find all campaign memberships for the user
    const memberships = await prisma.campaignMembership.findMany({
      where: {
        userId: user.userId
      },
      include: {
        campaign: {
          include: {
            _count: {
              select: {
                characters: true,
                scenes: true,
                memberships: true
              }
            }
          }
        }
      },
      orderBy: {
        joinedAt: 'desc'
      }
    })

    // Map to campaigns with role info
    const campaigns = memberships.map((m) => ({
      ...m.campaign,
      userRole: m.role
    }))

    return NextResponse.json({ campaigns })
  } catch (error) {
    return handleRouteError(error, 'Get campaigns error', 'Internal server error')
  }
}

// POST /api/campaigns - Create new campaign
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request)
    const body = await request.json()
    const { title, description, universe, aiSystemPrompt, initialWorldSeed, templateId, loreImport } = body

    if (!title) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Title is required' },
        { status: 400 }
      )
    }

    // Optional canon lore source, validated up front so a bad URL fails the
    // request before any generation runs. The import itself is async (a
    // wiki crawl takes minutes) — the campaign is created immediately with
    // a provisional generated world, and when the import finishes the
    // worker auto-reseeds that world from canon (lib/lore/reseedWorld.ts,
    // fresh-mode: replace, since no characters exist yet).
    let validatedLore: ValidatedLoreImport | null = null
    if (loreImport) {
      const sourceType = loreImport.sourceType
      if (!['PASTE', 'URL', 'WIKI'].includes(sourceType)) {
        return NextResponse.json<ErrorResponse>({ error: 'loreImport.sourceType must be PASTE, URL, or WIKI' }, { status: 400 })
      }
      let rawText: string | null = null
      let sourceUrl: string | null = null
      if (sourceType === 'PASTE') {
        rawText = typeof loreImport.rawText === 'string' ? loreImport.rawText.trim() : ''
        if (!rawText) {
          return NextResponse.json<ErrorResponse>({ error: 'loreImport.rawText is required for a pasted lore source' }, { status: 400 })
        }
        if (rawText.length > 200_000) {
          return NextResponse.json<ErrorResponse>({ error: 'Pasted lore is too long (max 200,000 characters)' }, { status: 400 })
        }
      } else {
        const urlCandidate = typeof loreImport.sourceUrl === 'string' ? loreImport.sourceUrl.trim() : ''
        try {
          new URL(urlCandidate)
        } catch {
          return NextResponse.json<ErrorResponse>({ error: 'A valid loreImport.sourceUrl is required' }, { status: 400 })
        }
        sourceUrl = urlCandidate
      }
      const sourceTitle = typeof loreImport.sourceTitle === 'string' && loreImport.sourceTitle.trim()
        ? loreImport.sourceTitle.trim().slice(0, 200)
        : null
      validatedLore = { sourceType, sourceUrl, rawText, sourceTitle }
    }

    // Resolve template if provided
    const template = templateId ? getTemplate(templateId) : null
    if (templateId && !template) {
      return NextResponse.json<ErrorResponse>(
        { error: `Template '${templateId}' not found` },
        { status: 400 }
      )
    }

    // Template fields take precedence unless the user explicitly overrode them
    const resolvedUniverse = universe || template?.universe || 'Original'
    const resolvedSystemPrompt = aiSystemPrompt || template?.systemPrompt || ''

    const campaign = await createCampaign({
      title,
      description,
      initialWorldSeed,
      resolvedUniverse,
      resolvedSystemPrompt,
      template: template || null,
      validatedLore,
      userId: user.userId,
    })

    await recordEvent('CAMPAIGN_CREATED', { userId: user.userId, campaignId: campaign.id })

    return NextResponse.json({ campaign }, { status: 201 })
  } catch (error) {
    return handleRouteError(error, 'Create campaign error', 'Internal server error')
  }
}
