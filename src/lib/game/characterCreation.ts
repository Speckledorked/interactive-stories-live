// src/lib/game/characterCreation.ts
// The business logic behind POST /api/campaigns/[id]/characters, moved out
// of the route handler: character row creation plus every best-effort
// seeding side effect that follows it (capability glimpses by origin
// familiarity, an origin archetype's extra glimpses and starting tie,
// first-party template starting debts, and contact NPC stubs). The route
// keeps auth, input validation, and the world-seeding/membership gates —
// this owns everything that happens once a character is known-valid to
// create.

import { prisma } from '@/lib/prisma'
import { OriginFamiliarity } from '@prisma/client'
import { decideSeedStates } from '@/lib/game/capabilities'
import { getTemplate } from '@/lib/templates/campaign-templates'
import { resolveOrCreateLocationId } from '@/lib/game/worldUpdaters/locations'
import { ensureContactNpcStubs } from '@/lib/wiki/contactNpcStubs'

export interface CreateCharacterBody {
  name: string
  // Origin archetype card picked in the creation wizard, if any — seeds
  // extra capability glimpses and a starting tie (Debt/faction standing).
  archetypeId?: string
  // Knowledge-relative sheet: how familiar this character is with the
  // universe's systems — drives capability discovery seeding.
  originFamiliarity?: 'NATIVE' | 'NEWCOMER' | 'OUTSIDER'
  pronouns?: string
  description?: string
  appearance?: string
  personality?: string
  stats?: any
  backstory?: string
  goals?: string
  currentLocation?: string
  moves?: string[]
  perks?: Array<{
    id: string
    name: string
    description: string
    tags?: string[]
  }>
  equipment?: {
    weapon?: string
    armor?: string
    misc?: string
  }
  inventory?: {
    items?: Array<{
      id: string
      name: string
      quantity: number
      tags: string[]
    }>
  }
  resources?: {
    gold?: number
    contacts?: string[]
  }
  consequences?: {
    promises?: string[]
    debts?: string[]
    enemies?: string[]
    longTermThreats?: string[]
  }
}

export async function createCharacter(campaignId: string, userId: string, body: CreateCharacterBody) {
  const originFamiliarity: OriginFamiliarity =
    body.originFamiliarity && ['NATIVE', 'NEWCOMER', 'OUTSIDER'].includes(body.originFamiliarity)
      ? body.originFamiliarity
      : 'NATIVE'

  // Resolve/create the matching Location row and link it via locationId
  // alongside the free-text field (see README Known Bugs P1 — Location
  // stored as free text, not an FK) — same helper the AI write-back path
  // uses for a PC's reported movement.
  const locationId = await resolveOrCreateLocationId(prisma, campaignId, body.currentLocation, true)

  const character = await prisma.character.create({
    data: {
      campaignId,
      userId,
      name: body.name,
      originFamiliarity,
      pronouns: body.pronouns,
      description: body.description,
      appearance: body.appearance,
      personality: body.personality,
      stats: body.stats,
      backstory: body.backstory,
      goals: body.goals,
      currentLocation: body.currentLocation,
      locationId,
      moves: body.moves || [],
      equipment: body.equipment || undefined,
      inventory: body.inventory || undefined,
      resources: body.resources || undefined,
      perks: body.perks || undefined,
      consequences: body.consequences || undefined,
    },
  })

  // Knowledge-relative sheet seeding: what this character already knows
  // EXISTS in this universe, by origin (never what they can do — nothing
  // seeds UNLOCKED; ability comes from the fiction).
  try {
    const scaffold = await prisma.campaignCapability.findMany({
      where: { campaignId },
      select: { id: true, tier: true, isSecret: true, parentId: true }
    })
    const seeds = decideSeedStates(originFamiliarity, scaffold)
    if (seeds.length > 0) {
      await prisma.characterCapability.createMany({
        data: seeds.map(s => ({
          characterId: character.id,
          capabilityId: s.capabilityId,
          state: s.state,
          source: `Grew up knowing of this (${originFamiliarity.toLowerCase()})`
        })),
        skipDuplicates: true
      })
      console.log(`📖 Seeded ${seeds.length} capability glimpses for ${body.name} (${originFamiliarity})`)
    }
  } catch (seedError) {
    // Non-critical: a character without seeds just has a blanker sheet.
    console.error('Failed to seed character capabilities:', seedError)
  }

  // Origin archetype seeding: if the player picked an archetype card,
  // seed its extra capability glimpses and its starting tie into the
  // living world (a Debt or a faction standing). Best-effort — the
  // character exists either way; the archetype's stats/gear were already
  // applied client-side as wizard prefill.
  if (body.archetypeId && typeof body.archetypeId === 'string') {
    try {
      const archetype = await prisma.campaignArchetype.findFirst({
        where: { id: body.archetypeId, campaignId }
      })
      if (archetype) {
        // Extra glimpses on top of familiarity seeding.
        if (archetype.glimpseCapabilityKeys.length > 0) {
          const nodes = await prisma.campaignCapability.findMany({
            where: { campaignId, key: { in: archetype.glimpseCapabilityKeys }, isSecret: false },
            select: { id: true }
          })
          if (nodes.length > 0) {
            await prisma.characterCapability.createMany({
              data: nodes.map(n => ({
                characterId: character.id,
                capabilityId: n.id,
                state: 'GLIMPSED' as const,
                source: `${archetype.name} background`
              })),
              skipDuplicates: true
            })
          }
        }

        // Starting tie into the living world.
        const tie = archetype.startingTie as any
        if (tie?.kind && tie?.counterparty_name) {
          if (tie.kind === 'faction_standing') {
            const faction = await prisma.faction.findFirst({
              where: { campaignId, name: { equals: tie.counterparty_name, mode: 'insensitive' } },
              select: { id: true }
            })
            if (faction) {
              const value = Math.max(-2, Math.min(2, Number(tie.standing_value) || 1))
              await prisma.factionStanding.upsert({
                where: { characterId_factionId: { characterId: character.id, factionId: faction.id } },
                create: { campaignId, characterId: character.id, factionId: faction.id, value },
                update: { value }
              })
              console.log(`⭐ Archetype tie: standing ${value} with ${tie.counterparty_name}`)
            }
          } else {
            const direction = tie.kind === 'debt_owed_by_character' ? 'OWED_BY_CHARACTER' : 'OWED_TO_CHARACTER'
            const counterpartyType = tie.counterparty_type === 'faction' ? 'faction' : 'npc'
            const counterparty = counterpartyType === 'faction'
              ? await prisma.faction.findFirst({
                  where: { campaignId, name: { equals: tie.counterparty_name, mode: 'insensitive' } },
                  select: { id: true }
                })
              : await prisma.nPC.findFirst({
                  where: { campaignId, name: { equals: tie.counterparty_name, mode: 'insensitive' } },
                  select: { id: true }
                })
            await prisma.debt.create({
              data: {
                campaignId,
                characterId: character.id,
                direction,
                counterpartyType,
                counterpartyId: counterparty?.id || null,
                counterpartyName: tie.counterparty_name,
                description: tie.description || `A tie from their past as ${archetype.name}`
              }
            })
            console.log(`🤝 Archetype tie: debt ${direction} ${tie.counterparty_name}`)
          }
        }
      }
    } catch (archetypeError) {
      console.error('Failed to apply archetype seeding (non-critical):', archetypeError)
    }
  }

  // #13 first-party templates: the starting complication every character
  // in this world begins already entangled in (see campaign-templates.ts
  // startingDebtTemplates doc — Debts need a real characterId, which is
  // why this runs here and not at campaign creation). Independent of any
  // archetype tie above: a template obligation and a personal archetype
  // tie are different layers of the fiction, not alternatives.
  try {
    const campaignForTemplate = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { templateId: true },
    })
    const template = campaignForTemplate?.templateId ? getTemplate(campaignForTemplate.templateId) : null
    if (template?.startingDebtTemplates && template.startingDebtTemplates.length > 0) {
      for (const debtTemplate of template.startingDebtTemplates) {
        const faction = await prisma.faction.findFirst({
          where: { campaignId, name: { equals: debtTemplate.counterpartyFactionName, mode: 'insensitive' } },
          select: { id: true },
        })
        await prisma.debt.create({
          data: {
            campaignId,
            characterId: character.id,
            direction: debtTemplate.direction === 'owed_by_character' ? 'OWED_BY_CHARACTER' : 'OWED_TO_CHARACTER',
            counterpartyType: 'faction',
            counterpartyId: faction?.id || null,
            counterpartyName: debtTemplate.counterpartyFactionName,
            description: debtTemplate.description,
          },
        })
      }
      console.log(`🤝 Seeded ${template.startingDebtTemplates.length} template starting debt(s) for ${body.name}`)
    }
  } catch (templateDebtError) {
    console.error('Failed to seed template starting debts (non-critical):', templateDebtError)
  }

  // Auto-create NPCs for contacts mentioned in character's backstory
  if (body.resources?.contacts && body.resources.contacts.length > 0) {
    await ensureContactNpcStubs(campaignId, body.name, body.resources.contacts)
  }

  return character
}
