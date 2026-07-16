// src/app/api/campaigns/[id]/characters/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { validateStats } from '@/lib/game/advancement'
import { decideSeedStates } from '@/lib/game/capabilities'
import { isWorldSeeding, SEEDING_MESSAGE } from '@/lib/lore/seedingGate'
import { recordEvent } from '@/lib/analytics/events'
import { getTemplate } from '@/lib/templates/campaign-templates'
import { OriginFamiliarity } from '@prisma/client'

interface CreateCharacterBody {
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
    slots?: number
  }
  resources?: {
    gold?: number
    contacts?: string[]
    reputation?: Record<string, number>
  }
  consequences?: {
    promises?: string[]
    debts?: string[]
    enemies?: string[]
    longTermThreats?: string[]
  }
}

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
    const body: CreateCharacterBody = await request.json()

    if (!body.name) {
      return NextResponse.json(
        { error: 'Character name is required' },
        { status: 400 }
      )
    }

    // Play lock: no characters until a creation-time canon import has
    // finished reseeding the world — a character created now would freeze
    // the provisional world in place (see lib/lore/seedingGate.ts).
    if (await isWorldSeeding(campaignId)) {
      return NextResponse.json({ error: SEEDING_MESSAGE, worldSeeding: true }, { status: 409 })
    }

    // Validate stats if provided
    if (body.stats) {
      const validation = validateStats(body.stats as Record<string, number>)
      if (!validation.valid) {
        return NextResponse.json(
          { error: `Invalid stats: ${validation.error}` },
          { status: 400 }
        )
      }
    }

    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'You are not a member of this campaign' },
        { status: 403 }
      )
    }

    const originFamiliarity: OriginFamiliarity =
      body.originFamiliarity && ['NATIVE', 'NEWCOMER', 'OUTSIDER'].includes(body.originFamiliarity)
        ? body.originFamiliarity
        : 'NATIVE'

    const character = await prisma.character.create({
      data: {
        campaignId,
        userId: user.userId,
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
        select: { id: true, tier: true, isSecret: true }
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
      for (const contactName of body.resources.contacts) {
        try {
          // Check if NPC already exists with this name or alias
          const existingNPC = await prisma.wikiEntry.findFirst({
            where: {
              campaignId,
              entryType: 'NPC',
              OR: [
                { name: contactName },
                { aliases: { has: contactName } }
              ]
            }
          })

          if (!existingNPC) {
            // Create stub NPC entry
            await prisma.wikiEntry.create({
              data: {
                campaignId,
                entryType: 'NPC',
                name: contactName,
                summary: `Contact of ${body.name}`,
                description: `${contactName} is a known contact of ${body.name}. More details will be revealed through gameplay.`,
                tags: ['contact', 'unmet'],
                aliases: [],
                importance: 'normal',
                createdBy: 'system'
              }
            })
            console.log(`✨ Auto-created NPC: ${contactName} (contact of ${body.name})`)
          }
        } catch (npcError) {
          // Log error but don't fail character creation
          console.error(`Failed to auto-create NPC for contact ${contactName}:`, npcError)
        }
      }
    }

    await recordEvent('CHARACTER_CREATED', { userId: user.userId, campaignId })

    return NextResponse.json({ character })
  } catch (error) {
    console.error('Create character error:', error)
    return NextResponse.json(
      { error: 'Failed to create character' },
      { status: 500 }
    )
  }
}

export async function GET(
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
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'You are not a member of this campaign' },
        { status: 403 }
      )
    }

    const characters = await prisma.character.findMany({
      where: {
        campaignId,
        isAlive: true,
      },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    return NextResponse.json({ characters })
  } catch (error) {
    console.error('Get characters error:', error)
    return NextResponse.json(
      { error: 'Failed to get characters' },
      { status: 500 }
    )
  }
}
