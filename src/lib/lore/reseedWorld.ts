// src/lib/lore/reseedWorld.ts
// Lore-aware world generation: regenerate a campaign's world structure
// from its imported canon. Shared by the admin "Reseed world from lore"
// button (api/campaigns/[id]/reseed-from-lore) and the automatic
// creation-time path (loreQueue fires this when a job created alongside
// the campaign finishes importing).
//
// Two merge modes, decided by whether anyone has committed to the world:
//
// FRESH (no characters yet — e.g. right after creation, before the
// background import finished): the provisional generated world is
// REPLACED by the canon one. Non-canon factions are retired (deactivated
// + hidden, never deleted — FK-safe), the unreferenced capability
// scaffold is rebuilt, stat labels / corruption theme / archetypes are
// regenerated from canon.
//
// LIVE (characters exist): strictly non-destructive. Factions and
// capabilities are additive, stat labels and the corruption theme fill in
// only if absent, archetypes are left alone.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { generateWorldFromTemplate } from '@/lib/ai/worldGenerator'
import { generateWorldExtras } from '@/lib/ai/worldExtras'
import { buildLoreDigest } from './loreDigest'
import { createFactionsForCampaign } from '@/lib/templates/campaign-templates'
import { slugifyCapabilityKey } from '@/lib/game/capabilities'

// The extras call already carries factions + capability keys, so it needs
// less raw canon than base world generation does.
const EXTRAS_DIGEST_CHARS = 6000

export interface ReseedSummary {
  fresh: boolean
  loreEntriesSampled: number
  loreEntriesTotal: number
  factionsAdded: string[]
  factionsRetired: string[]
  factionsAlreadyPresent: number
  capabilitiesAdded: string[]
  statLabelsSet: boolean
  corruptionThemeSet: boolean
  archetypesReplaced: number
  archetypesSkipped: boolean
}

export type ReseedResult =
  | { ok: true; summary: ReseedSummary }
  | { ok: false; reason: 'not_found' | 'no_lore' | 'generation_failed' }

/**
 * Pure: which generated factions to add, and (fresh mode only) which
 * existing ones to retire because canon replaced them. Name comparison is
 * case-insensitive; a generated faction matching an existing name keeps
 * the existing row.
 */
export function planFactionMerge(
  existingNames: string[],
  generatedNames: string[],
  fresh: boolean
): { toAdd: string[]; toRetire: string[] } {
  const existingLower = new Set(existingNames.map(n => n.toLowerCase()))
  const generatedLower = new Set(generatedNames.map(n => n.toLowerCase()))
  return {
    toAdd: generatedNames.filter(n => !existingLower.has(n.toLowerCase())),
    toRetire: fresh
      ? existingNames.filter(n => !generatedLower.has(n.toLowerCase()))
      : [],
  }
}

export async function reseedWorldFromLore(campaignId: string): Promise<ReseedResult> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } })
  if (!campaign) return { ok: false, reason: 'not_found' }

  const lore = await buildLoreDigest(prisma, campaignId)
  if (!lore) return { ok: false, reason: 'no_lore' }

  const characterCount = await prisma.character.count({ where: { campaignId } })
  const fresh = characterCount === 0

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
  if (!generated) return { ok: false, reason: 'generation_failed' }

  // --- Factions ------------------------------------------------------------
  const existingFactions = await prisma.faction.findMany({
    where: { campaignId },
    select: { name: true, description: true, isActive: true },
  })
  const plan = planFactionMerge(
    existingFactions.filter(f => f.isActive).map(f => f.name),
    generated.factions.map(f => f.name),
    fresh
  )
  const newFactions = generated.factions.filter(f => plan.toAdd.includes(f.name))
  if (newFactions.length > 0) {
    await createFactionsForCampaign(campaignId, prisma, newFactions)
  }
  if (plan.toRetire.length > 0) {
    // Retire, never delete: tick logs / wars / standings may reference the
    // rows, and an inactive+undiscovered faction is invisible to both the
    // simulation and the players.
    await prisma.faction.updateMany({
      where: { campaignId, name: { in: plan.toRetire } },
      data: { isActive: false, isDiscovered: false },
    })
  }

  // --- Capability scaffold ---------------------------------------------------
  if (fresh) {
    // Rebuild: drop scaffold nodes nobody's sheet references (with zero
    // characters that is all of them; the guard keeps this safe if a
    // character appears mid-flight).
    await prisma.campaignCapability.deleteMany({
      where: { campaignId, characterStates: { none: {} } },
    })
  }
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

  // --- Stat labels -----------------------------------------------------------
  // Fresh: canon replaces the provisional labels. Live: fill-only.
  let statLabelsSet = false
  if (generated.statLabels && (fresh || !campaign.statLabels)) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { statLabels: generated.statLabels as object },
    })
    statLabelsSet = true
  }

  // --- Extras: archetypes + corruption theme ---------------------------------
  const wantArchetypes = fresh
  const wantTheme = fresh || !campaign.corruptionTheme

  let archetypesReplaced = 0
  let corruptionThemeSet = false
  // What the campaign's theme ends up being after this pass (used for the
  // shadow-branch invariant below). Starts as the current value.
  let finalHasTheme = Boolean(campaign.corruptionTheme)

  if (wantArchetypes || wantTheme) {
    const allFactions = [
      ...existingFactions
        .filter(f => f.isActive && !plan.toRetire.includes(f.name))
        .map(f => ({ name: f.name, description: f.description || '' })),
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
      if (wantTheme) {
        if (extras.corruptionTheme) {
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { corruptionTheme: extras.corruptionTheme as object },
          })
          corruptionThemeSet = true
          finalHasTheme = true
        } else if (fresh && campaign.corruptionTheme) {
          // Canon says this universe has no power-at-a-cost concept — on a
          // fresh campaign that verdict replaces the provisional theme.
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { corruptionTheme: Prisma.JsonNull },
          })
          finalHasTheme = false
        }
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

  // --- Shadow branches: keep the corruption invariant --------------------------
  // Themed campaign: secret scaffold nodes are the forbidden arts
  // (idempotent re-mark). Fresh campaign whose theme just went away: clear
  // the flag so nothing stays gated on a track that no longer exists.
  if (finalHasTheme) {
    await prisma.campaignCapability.updateMany({
      where: { campaignId, isSecret: true },
      data: { isShadow: true },
    })
  } else if (fresh) {
    await prisma.campaignCapability.updateMany({
      where: { campaignId, isShadow: true },
      data: { isShadow: false },
    })
  }

  const summary: ReseedSummary = {
    fresh,
    loreEntriesSampled: lore.sampledEntries,
    loreEntriesTotal: lore.totalEntries,
    factionsAdded: newFactions.map(f => f.name),
    factionsRetired: plan.toRetire,
    factionsAlreadyPresent: generated.factions.length - newFactions.length,
    capabilitiesAdded: newCaps.map(c => c.name),
    statLabelsSet,
    corruptionThemeSet,
    archetypesReplaced,
    archetypesSkipped: !wantArchetypes,
  }

  console.log(
    `🌍 Reseeded world from lore for ${campaignId} (${fresh ? 'fresh — replaced' : 'live — additive'}):` +
    ` +${summary.factionsAdded.length} factions (${summary.factionsRetired.length} retired),` +
    ` +${summary.capabilitiesAdded.length} capabilities` +
    ` (sampled ${lore.sampledEntries}/${lore.totalEntries} lore entries)`
  )

  return { ok: true, summary }
}
