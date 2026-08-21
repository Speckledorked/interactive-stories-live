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
import { parseAdvancementTrack, resolveTierKey, startingTierKey, type AdvancementTrack } from './advancementTrack'
import { UNLOCK_STARTING_PROFICIENCY } from '@/lib/game/capabilities'

export interface CreateCharacterBody {
  name: string
  // Where this character starts on the campaign's rank ladder, by rung key
  // or label. An ESTABLISHED character is a legitimate concept — an Iron
  // adventurer with essences already bound, or higher — so any DECLARED rung
  // may be claimed. The closed shape still holds: the value is resolved
  // against the campaign's track (resolveTierKey) and never stored raw, so
  // you can claim Diamond but not "Cosmic Overlord". Absent or unresolvable
  // falls back to the lowest rung, which stays the default for a brand-new
  // character. Same trust model as archetypeId below: the client picks among
  // campaign-generated content, the server validates membership.
  advancementTier?: string
  // Capabilities this character already commands when the story begins —
  // the "essences already bound" half of an established concept. Validated
  // against the campaign scaffold (see validateStartingCapabilities): ids
  // must be campaign-scoped and neither secret nor shadow; slot-group
  // capacities bound the count per domain; the prerequisite DAG must be
  // respected within the selected set. Each becomes UNLOCKED at the same
  // proficiency an in-play unlock grants — established, not legendary; the
  // story is where mastery grows.
  startingCapabilityIds?: string[]
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

/**
 * The starting loadout was rejected. The route maps this to a 400 with the
 * message intact — these are player-fixable problems (too many essences, a
 * capstone without its foundation), not server errors.
 */
export class StartingLoadoutError extends Error {}

/**
 * Validate a player-declared starting loadout against the campaign.
 *
 * Returns the ids to seed as UNLOCKED. Three layers, none invented here:
 *
 * - Visibility: only campaign-scoped, non-secret, non-shadow nodes exist as
 *   far as creation is concerned — the same surface glimpse seeding exposes.
 *   Shadow arts additionally require corruption >= tier to unlock IN PLAY,
 *   and a fresh character has zero corruption, so starting with one would
 *   bypass a gate the engine enforces everywhere else. Ineligible ids are
 *   dropped silently, matching the archetype-glimpse path: the client should
 *   never have offered them, and telling a player "you may not have the
 *   thing you cannot see" leaks that it exists.
 * - Slot-group capacity: the generator declared how many essences (or spell
 *   schools, covenant marks) this world allows; a loadout cannot start past
 *   a capacity the fiction itself states. Refused loudly, by group name.
 * - Prerequisite closure: the #372 DAG holds at creation exactly as it holds
 *   in play — a selected node's prerequisites must be in the selection too.
 *   An established character earned the whole chain, not just its capstone.
 */
export async function resolveStartingCapabilities(
  campaignId: string,
  track: AdvancementTrack | null,
  requestedIds: string[] | undefined
): Promise<string[]> {
  if (!requestedIds || requestedIds.length === 0) return []
  const unique = [...new Set(requestedIds.filter((id) => typeof id === 'string' && id))]
  if (unique.length === 0) return []

  const eligible = await prisma.campaignCapability.findMany({
    where: { campaignId, id: { in: unique }, isSecret: false, isShadow: false },
    select: {
      id: true,
      name: true,
      domain: true,
      prerequisites: { select: { prerequisiteCapabilityId: true, prerequisite: { select: { name: true } } } },
    },
  })
  const selected = new Set(eligible.map((c) => c.id))

  for (const node of eligible) {
    for (const prereq of node.prerequisites) {
      if (!selected.has(prereq.prerequisiteCapabilityId)) {
        throw new StartingLoadoutError(
          `"${node.name}" builds on "${prereq.prerequisite.name}" — an established character earned ` +
            `the whole chain, so include it in the starting loadout too.`
        )
      }
    }
  }

  for (const group of track?.slotGroups ?? []) {
    const inGroup = eligible.filter((c) => c.domain === group.domain).length
    if (inGroup > group.capacity) {
      throw new StartingLoadoutError(
        `${inGroup} starting capabilities in ${group.label}, but this world allows ${group.capacity}.`
      )
    }
  }

  return eligible.map((c) => c.id)
}

export async function createCharacter(campaignId: string, userId: string, body: CreateCharacterBody) {
  const originFamiliarity: OriginFamiliarity =
    body.originFamiliarity && ['NATIVE', 'NEWCOMER', 'OUTSIDER'].includes(body.originFamiliarity)
      ? body.originFamiliarity
      : 'NATIVE'

  // Resolve/create the matching Location row and link it via locationId
  // alongside the free-text field (see #425 — Location
  // stored as free text alongside the FK) — same helper the AI write-back path
  // uses for a PC's reported movement.
  const locationId = await resolveOrCreateLocationId(prisma, campaignId, body.currentLocation, true)

  // Place a new character on the bottom rung of this world's ladder, when it
  // has one.
  //
  // This is the ONE case where the lowest rung is the right answer without
  // trusting the generator's ordering: a character being created has done
  // nothing yet, so whatever the bottom is called, they are on it. Doing the
  // same inference at RENDER time — which is what tierProgress used to do for
  // any null tier — is not equivalent: it claimed a rank for every existing
  // character too, including veterans of campaigns that had no ladder when
  // they were made.
  //
  // Existing characters stay null and read as "not yet ranked" until the
  // fiction places them, which the GM can now do because the ladder reaches
  // the scene prompt.
  const campaignTrack = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { advancementTrack: true },
  })
  const track = parseAdvancementTrack(campaignTrack?.advancementTrack)
  // A claimed rung resolves against the declared ladder or falls back to the
  // bottom — never stored raw, never invented. Ladderless campaigns stay null.
  const advancementTier = resolveTierKey(track, body.advancementTier) ?? startingTierKey(track)

  // Validate the starting-capability selection BEFORE creating anything, so a
  // rejected loadout leaves no half-made character behind.
  const startingCapabilities = await resolveStartingCapabilities(
    campaignId,
    track,
    body.startingCapabilityIds
  )

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
      // null when this universe has no ladder — the column stays meaningfully
      // empty rather than being stamped with a rank that does not exist.
      advancementTier,
    },
  })

  // Established-character loadout: capabilities the player declared as part
  // of who this character already is. Seeded FIRST and as UNLOCKED, before
  // the glimpse seeding below — both writes share the (characterId,
  // capabilityId) unique key and glimpse seeding uses skipDuplicates, so
  // this order means an already-mastered node is never shadowed down to a
  // glimpse. Proficiency is the same floor an in-play unlock grants: an
  // Iron veteran can do these things; the story hasn't tested them yet.
  if (startingCapabilities.length > 0) {
    try {
      await prisma.characterCapability.createMany({
        data: startingCapabilities.map((id) => ({
          characterId: character.id,
          capabilityId: id,
          state: 'UNLOCKED' as const,
          proficiency: UNLOCK_STARTING_PROFICIENCY,
          unlockedAt: new Date(),
          source: 'Part of who they were before the story began',
        })),
        skipDuplicates: true,
      })
      console.log(`⚔️ Seeded ${startingCapabilities.length} established capabilities for ${body.name}`)
    } catch (loadoutError) {
      // Non-critical after validation passed: the character exists; a missed
      // loadout row reads as "not yet shown in the fiction".
      console.error('Failed to seed starting capabilities:', loadoutError)
    }
  }

  // Knowledge-relative sheet seeding: what this character already knows
  // EXISTS in this universe, by origin. Familiarity and archetype seeding
  // only ever create GLIMPSED rows — UNLOCKED at creation comes solely from
  // the validated starting loadout above.
  try {
    const scaffold = await prisma.campaignCapability.findMany({
      where: { campaignId },
      // #372: "is anything in front of this node" is a count now, not a
      // parent id — a node may have several prerequisites, and seeding only
      // ever asks whether it has any.
      select: { id: true, tier: true, isSecret: true, _count: { select: { prerequisites: true } } }
    })
    const seeds = decideSeedStates(
      originFamiliarity,
      scaffold.map((c) => ({ ...c, prerequisiteCount: c._count.prerequisites }))
    )
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
