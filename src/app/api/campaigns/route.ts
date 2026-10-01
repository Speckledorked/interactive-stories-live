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
import { type ValidatedLoreImport } from '@/lib/game/campaignCreation'
import { enqueueCampaignCreation } from '@/lib/game/campaignCreationQueue'

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

    // #493: enqueue rather than build.
    //
    // This used to run five model calls and a seeding transaction inline —
    // a minute or more inside a request, with the client holding a spinner
    // and no way to say how far along it was. Now it validates (above,
    // unchanged — a bad request still fails here, immediately, rather than
    // becoming a job that fails later) and hands the work to its own
    // invocation.
    //
    // 202, not 201: nothing has been created yet. The body carries the job
    // to poll, not a campaign.
    const { jobId } = await enqueueCampaignCreation(user.userId, {
      title,
      description,
      initialWorldSeed,
      resolvedUniverse,
      resolvedSystemPrompt,
      templateId: template ? template.id : null,
      validatedLore,
    })

    // Recorded at the point of intent rather than completion, deliberately:
    // this is the funnel's "they asked for a world" step, and a creation
    // that dies in the worker is exactly the drop-off it needs to show.
    // Completion has its own evidence — the campaign row.
    await recordEvent('CAMPAIGN_CREATED', { userId: user.userId })

    return NextResponse.json({ jobId }, { status: 202 })
  } catch (error) {
    return handleRouteError(error, 'Create campaign error', 'Internal server error')
  }
}
