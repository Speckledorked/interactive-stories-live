// src/app/api/campaigns/route.ts
// Campaign management endpoints
// GET - List campaigns user belongs to
// POST - Create new campaign

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { CreateCampaignRequest, ErrorResponse } from '@/types/api'
import { getTemplate, applyCampaignTemplate } from '@/lib/templates/campaign-templates'
import { generateWorldFromTemplate } from '@/lib/ai/worldGenerator'

// GET /api/campaigns - List user's campaigns
export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request)

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
                scenes: true
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
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.error('Get campaigns error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/campaigns - Create new campaign
export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request)
    const body = await request.json()
    const { title, description, universe, aiSystemPrompt, initialWorldSeed, templateId } = body

    if (!title) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Title is required' },
        { status: 400 }
      )
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

    // If a template is selected and the user hasn't provided a custom world seed,
    // generate a unique world with AI before opening the transaction
    let resolvedWorldSeed = initialWorldSeed || ''
    let generatedFactions: Awaited<ReturnType<typeof generateWorldFromTemplate>>['factions'] | undefined

    if (template && !initialWorldSeed) {
      console.log('🌍 Generating unique world from template...')
      const generated = await generateWorldFromTemplate(template.id, title, description || '')
      if (generated) {
        resolvedWorldSeed = generated.worldSeed
        generatedFactions = generated.factions
        console.log(`✅ World generated: ${generated.factions.length} unique factions`)
      } else {
        // AI failed — fall back to template defaults
        resolvedWorldSeed = template.initialWorldSeed
        console.log('⚠️ World generation failed, using template defaults')
      }
    } else if (!resolvedWorldSeed) {
      resolvedWorldSeed = template?.initialWorldSeed || ''
    }

    // Create campaign, world meta, membership, and template data in one transaction
    const campaign = await prisma.$transaction(async (tx) => {
      const newCampaign = await tx.campaign.create({
        data: {
          title,
          description,
          universe: resolvedUniverse,
          aiSystemPrompt: resolvedSystemPrompt,
          initialWorldSeed: resolvedWorldSeed
        }
      })

      await tx.worldMeta.create({
        data: {
          campaignId: newCampaign.id,
          currentTurnNumber: 1,
          currentInGameDate: 'Day 1',
          otherMeta: {}
        }
      })

      await tx.campaignMembership.create({
        data: {
          userId: user.userId,
          campaignId: newCampaign.id,
          role: 'ADMIN'
        }
      })

      // Apply template moves + factions (AI-generated factions if available)
      if (template) {
        await applyCampaignTemplate(newCampaign.id, template.id, tx, generatedFactions)
      }

      return newCampaign
    })

    return NextResponse.json({ campaign }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.error('Create campaign error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
