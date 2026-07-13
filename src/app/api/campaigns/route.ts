// src/app/api/campaigns/route.ts
// Campaign management endpoints
// GET - List campaigns user belongs to
// POST - Create new campaign

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { CreateCampaignRequest, ErrorResponse } from '@/types/api'
import { getTemplate, applyCampaignTemplate } from '@/lib/templates/campaign-templates'
import { generateWorldFromTemplate, GeneratedCapability, GeneratedStatLabels } from '@/lib/ai/worldGenerator'
import { slugifyCapabilityKey } from '@/lib/game/capabilities'

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

    // Generate factions, the capability scaffold, and stat labels with AI
    // regardless of whether the user wrote their own world seed — writing
    // "what's happening when the story begins" and wanting AI-generated
    // factions/essences/etc are independent choices, not one or the other.
    // Only the world_seed TEXT itself defers to the user's own if they gave
    // one; everything else generated still applies on top of it.
    let resolvedWorldSeed = initialWorldSeed || ''
    let generatedFactions: NonNullable<Awaited<ReturnType<typeof generateWorldFromTemplate>>>['factions'] | undefined
    let generatedCapabilities: GeneratedCapability[] | undefined
    let generatedStatLabels: GeneratedStatLabels | undefined

    console.log('🌍 Generating world context (factions, capabilities, stat labels)...')
    const generated = await generateWorldFromTemplate(
      template?.id || null,
      title,
      description || '',
      template ? undefined : resolvedUniverse,
      initialWorldSeed || undefined
    )
    if (generated) {
      if (!initialWorldSeed) resolvedWorldSeed = generated.worldSeed
      generatedFactions = generated.factions
      generatedCapabilities = generated.capabilities
      generatedStatLabels = generated.statLabels
      console.log(`✅ World generated: ${generated.factions.length} unique factions`)
    } else if (!initialWorldSeed) {
      // AI failed and the user didn't write their own — fall back to
      // template defaults (or blank for custom).
      resolvedWorldSeed = template?.initialWorldSeed || ''
      console.log('⚠️ World generation failed, using fallback defaults')
    }

    // Create campaign, world meta, membership, and template data in one transaction
    const campaign = await prisma.$transaction(async (tx) => {
      const newCampaign = await tx.campaign.create({
        data: {
          title,
          description,
          universe: resolvedUniverse,
          aiSystemPrompt: resolvedSystemPrompt,
          initialWorldSeed: resolvedWorldSeed,
          statLabels: (generatedStatLabels as object | undefined) || undefined
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

      // Knowledge-relative sheets: persist the universe's capability
      // scaffold — the learnable systems characters will discover through
      // the fiction. Duplicated keys within one generation collapse via
      // skipDuplicates rather than failing the whole campaign create.
      if (generatedCapabilities && generatedCapabilities.length > 0) {
        await tx.campaignCapability.createMany({
          data: generatedCapabilities.map(c => ({
            campaignId: newCampaign.id,
            key: slugifyCapabilityKey(c.name),
            name: c.name,
            description: c.description || null,
            domain: c.domain,
            tier: c.tier,
            isSecret: c.isSecret
          })),
          skipDuplicates: true
        })
        console.log(`📖 Seeded ${generatedCapabilities.length} capability nodes`)
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
