// src/app/api/campaigns/[id]/reseed-from-lore/route.ts
// Lore-aware world generation (Phase 9): regenerate the campaign's world
// STRUCTURE from its imported lore. Creation-time generation necessarily
// runs before any lore can be imported, so a canon universe's great houses
// can't come from the wiki you feed it a minute later — this route closes
// that loop: import lore, then reseed.
//
// Merge semantics are deliberately non-destructive on a live campaign:
//   factions/capabilities — additive only (existing names/keys are never
//     touched; lore-derived ones that don't exist yet are added)
//   stat labels + corruption theme — fill-only (set when absent, never
//     replaced: characters may already be built on them)
//   archetypes — replaced only while the campaign has NO characters
//     (cards are applied at character creation, so once anyone exists the
//     old cards did their job and silently swapping them helps nobody)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { generateWorldFromTemplate } from '@/lib/ai/worldGenerator'
import { generateWorldExtras } from '@/lib/ai/worldExtras'
import { buildLoreDigest } from '@/lib/lore/loreDigest'
import { createFactionsForCampaign } from '@/lib/templates/campaign-templates'
import { slugifyCapabilityKey } from '@/lib/game/capabilities'
import { AI_ACTION_LIMIT, checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'

export const maxDuration = 60

// The extras call already carries factions + capability keys, so it needs
// less raw canon than base world generation does.
const EXTRAS_DIGEST_CHARS = 6000

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const membership = await prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId: user.userId, campaignId } },
    })
    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only campaign admins can reseed the world' }, { status: 403 })
    }

    const rateLimit = await checkRateLimit(
      user.userId, AI_ACTION_LIMIT.bucket, AI_ACTION_LIMIT.limit, AI_ACTION_LIMIT.windowSeconds
    )
    if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit)

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } })
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const lore = await buildLoreDigest(prisma, campaignId)
    if (!lore) {
      return NextResponse.json(
        { error: 'No imported lore to reseed from — import lore first (Admin → Lore).' },
        { status: 400 }
      )
    }

    const generated = await generateWorldFromTemplate(
      null,
      campaign.title,
      campaign.description || '',
      campaign.universe || undefined,
      // The existing opening situation stays canon — reseeding restructures
      // the world's pillars, it doesn't retcon how the story opened.
      campaign.initialWorldSeed || undefined,
      lore.digest
    )
    if (!generated) {
      return NextResponse.json({ error: 'World generation failed — try again in a moment' }, { status: 502 })
    }

    // --- Factions: additive merge -----------------------------------------
    const existingFactions = await prisma.faction.findMany({
      where: { campaignId },
      select: { name: true, description: true, isActive: true },
    })
    const existingFactionNames = new Set(existingFactions.map(f => f.name.toLowerCase()))
    const newFactions = generated.factions.filter(f => !existingFactionNames.has(f.name.toLowerCase()))
    if (newFactions.length > 0) {
      await createFactionsForCampaign(campaignId, prisma, newFactions)
    }

    // --- Capabilities: additive merge --------------------------------------
    const existingCaps = await prisma.campaignCapability.findMany({
      where: { campaignId },
      select: { key: true, name: true, description: true, domain: true, tier: true, isSecret: true },
    })
    const existingCapKeys = new Set(existingCaps.map(c => c.key))
    const newCaps = generated.capabilities.filter(
      c => !existingCapKeys.has(slugifyCapabilityKey(c.name))
    )
    if (newCaps.length > 0) {
      await prisma.campaignCapability.createMany({
        data: newCaps.map(c => ({
          campaignId,
          key: slugifyCapabilityKey(c.name),
          name: c.name,
          description: c.description || null,
          domain: c.domain,
          tier: c.tier,
          isSecret: c.isSecret,
        })),
        skipDuplicates: true,
      })
    }

    // --- Stat labels: fill-only --------------------------------------------
    let statLabelsSet = false
    if (!campaign.statLabels && generated.statLabels) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { statLabels: generated.statLabels as object },
      })
      statLabelsSet = true
    }

    // --- Extras (archetypes + corruption theme), only when usable ----------
    const characterCount = await prisma.character.count({ where: { campaignId } })
    const wantArchetypes = characterCount === 0
    const wantTheme = !campaign.corruptionTheme

    let archetypesReplaced = 0
    let corruptionThemeSet = false
    if (wantArchetypes || wantTheme) {
      const allFactions = [
        ...existingFactions.filter(f => f.isActive).map(f => ({ name: f.name, description: f.description || '' })),
        ...newFactions.map(f => ({ name: f.name, description: f.description })),
      ]
      const allCaps = [
        ...existingCaps.map(c => ({
          name: c.name, description: c.description || '', domain: c.domain, tier: c.tier, isSecret: c.isSecret,
        })),
        ...newCaps,
      ]
      const extras = await generateWorldExtras(
        campaign.title,
        campaign.description || '',
        campaign.universe || 'Original',
        allFactions,
        allCaps,
        (statLabelsSet ? generated.statLabels : (campaign.statLabels as any)) || undefined,
        lore.digest.slice(0, EXTRAS_DIGEST_CHARS)
      )

      if (extras) {
        if (wantTheme && extras.corruptionTheme) {
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { corruptionTheme: extras.corruptionTheme as object },
          })
          corruptionThemeSet = true
        }
        if (wantArchetypes && extras.archetypes.length > 0) {
          await prisma.campaignArchetype.deleteMany({ where: { campaignId } })
          const created = await prisma.campaignArchetype.createMany({
            data: extras.archetypes.map(a => ({
              campaignId,
              name: a.name,
              description: a.description,
              originFamiliarity: a.originFamiliarity,
              suggestedStats: (a.suggestedStats as object | null) || undefined,
              startingGear: (a.startingGear as object | null) || undefined,
              startingTie: (a.startingTie as object | null) || undefined,
              backstoryPrompts: a.backstoryPrompts,
              glimpseCapabilityKeys: a.glimpseCapabilityKeys,
            })),
          })
          archetypesReplaced = created.count
        }
      }
    }

    // --- Shadow branches: keep the corruption invariant ---------------------
    // Same rule as creation/backfill: in a themed campaign, secret scaffold
    // nodes are the forbidden arts. Idempotent for already-marked nodes and
    // covers both orders (theme existed before reseed, or was just set).
    if (campaign.corruptionTheme || corruptionThemeSet) {
      await prisma.campaignCapability.updateMany({
        where: { campaignId, isSecret: true },
        data: { isShadow: true },
      })
    }

    console.log(
      `🌍 Reseeded world from lore for ${campaignId}: +${newFactions.length} factions, +${newCaps.length} capabilities` +
      ` (sampled ${lore.sampledEntries}/${lore.totalEntries} lore entries)`
    )

    return NextResponse.json({
      loreEntriesSampled: lore.sampledEntries,
      loreEntriesTotal: lore.totalEntries,
      factionsAdded: newFactions.map(f => f.name),
      factionsAlreadyPresent: generated.factions.length - newFactions.length,
      capabilitiesAdded: newCaps.map(c => c.name),
      statLabelsSet,
      corruptionThemeSet,
      archetypesReplaced,
      archetypesSkipped: !wantArchetypes,
    })
  } catch (error) {
    console.error('Reseed-from-lore error:', error)
    return NextResponse.json({ error: 'Failed to reseed world from lore' }, { status: 500 })
  }
}
