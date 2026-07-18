// src/app/api/campaigns/route.ts
// Campaign management endpoints
// GET - List campaigns user belongs to
// POST - Create new campaign

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { CreateCampaignRequest, ErrorResponse } from '@/types/api'
import { getTemplate, applyCampaignTemplate, createFactionsForCampaign, createNPCsForCampaign, createLocationsForCampaign } from '@/lib/templates/campaign-templates'
import { generateWorldFromTemplate, GeneratedCapability, GeneratedStatLabels, GeneratedFront, GeneratedNPC, GeneratedLocation } from '@/lib/ai/worldGenerator'
import { generateWorldExtras, GeneratedWorldExtras } from '@/lib/ai/worldExtras'
import { generateMoveFlavor, GeneratedMoveFlavor } from '@/lib/ai/moveFlavor'
import { BASIC_MOVES } from '@/lib/pbta-moves'
import { slugifyCapabilityKey } from '@/lib/game/capabilities'
import { kickLoreImportJob } from '@/lib/lore/loreQueue'
import { clearPendingWorldSeed } from '@/lib/lore/reseedWorld'
import { recordEvent } from '@/lib/analytics/events'

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
    let validatedLore: { sourceType: 'URL' | 'WIKI' | 'PASTE'; sourceUrl: string | null; rawText: string | null; sourceTitle: string | null } | null = null
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
    let generatedFronts: GeneratedFront[] | undefined
    let generatedNpcs: GeneratedNPC[] | undefined
    let generatedLocations: GeneratedLocation[] | undefined

    console.log('🌍 Generating world context (factions, capabilities, stat labels, fronts)...')
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
      generatedFronts = generated.fronts
      console.log(`✅ World generated: ${generated.factions.length} unique factions, ${generated.fronts.length} fronts`)
    } else if (!initialWorldSeed) {
      // AI failed and the user didn't write their own — fall back to
      // template defaults (or blank for custom).
      resolvedWorldSeed = template?.initialWorldSeed || ''
      console.log('⚠️ World generation failed, using fallback defaults')
    }

    // Second-stage generation: origin archetype cards, the corruption
    // theme, and notable NPCs/locations, grounded in the factions/
    // capabilities generated above. A separate call from the one above on
    // purpose — that one is already at its own token budget, and cramming
    // more into it risks truncating its JSON response, which would zero
    // out factions/capabilities/fronts too, not just this stage's content.
    // Fail-open — a campaign without these still works (blank creation
    // wizard, no corruption track, wiki without NPCs/locations until play
    // introduces them).
    let worldExtras: GeneratedWorldExtras | null = null
    let generatedMoveFlavor: GeneratedMoveFlavor[] | null = null
    try {
      // Independent calls, run together: move flavor doesn't need factions/
      // capabilities as input (only stat labels), so there's no ordering
      // dependency between the two — see lib/ai/moveFlavor.ts's doc comment
      // for why this is a separate call rather than folded into either.
      const [extrasResult, moveFlavorResult] = await Promise.all([
        generateWorldExtras(
          title,
          description || '',
          resolvedUniverse,
          (generatedFactions || []).map(f => ({ name: f.name, description: f.description })),
          generatedCapabilities || [],
          generatedStatLabels
        ),
        generateMoveFlavor(title, description || '', resolvedUniverse, generatedStatLabels),
      ])
      worldExtras = extrasResult
      generatedMoveFlavor = moveFlavorResult
      if (worldExtras) {
        generatedNpcs = worldExtras.npcs
        generatedLocations = worldExtras.locations
      }
    } catch (extrasError) {
      console.error('World extras generation failed (non-critical):', extrasError)
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
          statLabels: (generatedStatLabels as object | undefined) || undefined,
          // Null is meaningful: this universe has no power-at-a-cost
          // concept, so the corruption track stays disabled.
          corruptionTheme: (worldExtras?.corruptionTheme as object | undefined) || undefined,
          // Canon lore was provided: lock play until the import finishes
          // and the auto-reseed replaces this provisional world (see
          // lib/lore/seedingGate.ts).
          pendingWorldSeed: Boolean(validatedLore),
          // #13: which static template this came from, if any — lets
          // characters/route.ts apply the template's starting-Debt
          // scaffolding when each character joins (Debts need a real
          // characterId, unavailable at campaign creation).
          templateId: template?.id
        }
      })

      // Origin archetype cards — ready-to-play entry points into this
      // world (see lib/ai/worldExtras.ts and the character creation form).
      if (worldExtras && worldExtras.archetypes.length > 0) {
        await tx.campaignArchetype.createMany({
          data: worldExtras.archetypes.map(a => ({
            campaignId: newCampaign.id,
            name: a.name,
            description: a.description,
            originFamiliarity: a.originFamiliarity,
            suggestedStats: (a.suggestedStats as object | null) || undefined,
            startingGear: (a.startingGear as object | null) || undefined,
            startingTie: (a.startingTie as object | null) || undefined,
            backstoryPrompts: a.backstoryPrompts,
            glimpseCapabilityKeys: a.glimpseCapabilityKeys
          }))
        })
        console.log(`🎭 Seeded ${worldExtras.archetypes.length} origin archetypes`)
      }

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

      // Apply template factions (AI-generated factions if available).
      // Template-less/custom-universe campaigns still get their AI-generated
      // factions persisted directly — factions aren't a template-only concept.
      if (template) {
        await applyCampaignTemplate(
          newCampaign.id, template.id, tx, generatedFactions,
          Boolean(generatedCapabilities && generatedCapabilities.length > 0),
          Boolean(generatedFronts && generatedFronts.length > 0)
        )
      } else if (generatedFactions && generatedFactions.length > 0) {
        await createFactionsForCampaign(newCampaign.id, tx, generatedFactions)
        console.log(`✅ Persisted ${generatedFactions.length} AI-generated factions (no template)`)
      }

      // Per-campaign move flavor (see lib/ai/moveFlavor.ts) — every campaign
      // gets this, templated or not, unlike the retired per-template
      // defaultMoves. Absence (no API key, generation failed) just means
      // resolution.ts falls back to BASIC_MOVES' own generic display text.
      if (generatedMoveFlavor && generatedMoveFlavor.length > 0) {
        const rollTypeByKey = new Map(BASIC_MOVES.map(m => [m.key, m.rollType]))
        await tx.move.createMany({
          data: generatedMoveFlavor.map(m => ({
            campaignId: newCampaign.id,
            baseMoveKey: m.baseMoveKey,
            name: m.name,
            trigger: m.trigger,
            description: m.description,
            rollType: rollTypeByKey.get(m.baseMoveKey) || null,
            outcomes: m.outcomes,
            category: 'basic',
          })),
        })
        console.log(`🎲 Flavored ${generatedMoveFlavor.length} moves for "${title}"`)
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

        // Shadow branches: in a universe WITH a corruption theme, the
        // scaffold's secret nodes are its forbidden arts — unlockable only
        // by characters carrying enough corruption marks (tier = marks
        // required; see shadowUnlockBlocked). Only generation-time secrets
        // qualify: nodes discovered mid-story are born isSecret without
        // being forbidden, which is exactly why isShadow is its own flag.
        if (worldExtras?.corruptionTheme) {
          const shadowed = await tx.campaignCapability.updateMany({
            where: { campaignId: newCampaign.id, isSecret: true },
            data: { isShadow: true }
          })
          if (shadowed.count > 0) {
            console.log(`🌑 Marked ${shadowed.count} secret capability nodes as shadow branches`)
          }
        }
      }

      // Universal front-style threats (#13's concept, generated for EVERY
      // campaign now — template or not): a ticking danger clock the world
      // already opens with, grounded in canon when lore was imported.
      // relatedFactionId, deliberately NOT sourceFactionId — see the schema
      // comment on Clock — so completion gets the generic flavor-text event
      // instead of being mistaken for a tracked faction ambition.
      if (generatedFronts && generatedFronts.length > 0) {
        for (const front of generatedFronts) {
          let relatedFactionId: string | undefined
          if (front.sourceFactionName) {
            const faction = await tx.faction.findFirst({
              where: { campaignId: newCampaign.id, name: { equals: front.sourceFactionName, mode: 'insensitive' } },
              select: { id: true },
            })
            relatedFactionId = faction?.id
          }
          await tx.clock.create({
            data: {
              campaignId: newCampaign.id,
              name: front.name,
              description: front.description,
              category: front.category,
              maxTicks: front.maxTicks,
              consequence: front.consequence,
              relatedFactionId,
            },
          })
        }
        console.log(`⏰ Seeded ${generatedFronts.length} AI-generated front-style threats`)
      }

      // Notable NPCs and locations: previously nothing seeded these at
      // creation, so the wiki stayed empty of characters/places (only
      // factions/fronts existed) until actual play introduced anyone —
      // even on a campaign built from a full lore import. factionName/
      // ownerFactionName resolve against the factions just created above.
      if (generatedNpcs && generatedNpcs.length > 0) {
        await createNPCsForCampaign(newCampaign.id, tx, generatedNpcs)
        console.log(`🧑‍🤝‍🧑 Seeded ${generatedNpcs.length} AI-generated NPCs`)
      }
      if (generatedLocations && generatedLocations.length > 0) {
        await createLocationsForCampaign(newCampaign.id, tx, generatedLocations)
        console.log(`🗺️ Seeded ${generatedLocations.length} AI-generated locations`)
      }

      return newCampaign
    })

    await recordEvent('CAMPAIGN_CREATED', { userId: user.userId, campaignId: campaign.id })

    // Kick off the canon import AFTER the campaign exists. The kick has a
    // short delivery timeout, so this doesn't hold the response long; when
    // the import completes, the worker reseeds the provisional world above
    // from canon automatically.
    if (validatedLore) {
      try {
        const loreJob = await prisma.loreImportJob.create({
          data: {
            campaignId: campaign.id,
            sourceType: validatedLore.sourceType,
            sourceUrl: validatedLore.sourceUrl,
            sourceTitle: validatedLore.sourceTitle,
            rawText: validatedLore.rawText,
            autoReseedOnComplete: true,
          },
        })
        await kickLoreImportJob(loreJob.id)
        console.log(`📚 Creation-time lore import ${loreJob.id} started (auto-reseed on completion)`)
      } catch (loreError) {
        // The campaign is already created and fully playable on its
        // provisional world — a failed import start must not fail creation,
        // and must not leave the play lock behind.
        console.error('Failed to start creation-time lore import:', loreError)
        await clearPendingWorldSeed(campaign.id).catch(() => {})
      }
    }

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
