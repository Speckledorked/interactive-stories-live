// src/lib/templates/campaign-templates.ts
// Phase 18: Campaign Presets & Content Packs
// Pre-built system modules for quick campaign creation

import { slugifyCapabilityKey } from '@/lib/game/capabilities'

export interface CampaignTemplate {
  id: string
  name: string
  description: string
  universe: string
  systemPrompt: string
  initialWorldSeed: string
  defaultPerks: PerkTemplate[]
  factionTemplates: FactionTemplate[]
  startingItems: ItemTemplate[]
  // #13: front-style threats (Apocalypse World "fronts" — a ticking danger
  // clock with a stated consequence). sourceFactionName, when set, must
  // match a name in factionTemplates above — applyCampaignTemplate resolves
  // it to a real Faction id so the clock shows up tied to that faction, the
  // same linkage the world sim creates organically via ambition clocks.
  frontTemplates?: FrontTemplate[]
  // #13: capability scaffold. This is a FALLBACK baseline only — when AI
  // world generation succeeds it already produces a bespoke scaffold for
  // this exact campaign, which takes precedence (see campaigns/route.ts).
  // Templates guarantee every campaign gets a working scaffold even
  // offline (no OPENAI_API_KEY) or if the AI call fails.
  capabilityTemplates?: TemplateCapability[]
  // #13: a complication each new character starts the world already
  // entangled in. Applied at CHARACTER creation (Debt rows need a real
  // characterId, which doesn't exist yet at campaign creation) — see
  // api/campaigns/[id]/characters/route.ts. counterpartyFactionName must
  // match a name in factionTemplates above.
  startingDebtTemplates?: StartingDebtTemplate[]
  tags: string[]
}

export interface FrontTemplate {
  name: string
  description: string
  category: string
  maxTicks: number
  consequence: string
  sourceFactionName?: string
}

export interface TemplateCapability {
  domain: string
  name: string
  description: string
  tier: number // 1 = entry knowledge, 3 = deep art
  isSecret: boolean
}

export interface StartingDebtTemplate {
  description: string
  direction: 'owed_by_character' | 'owed_to_character'
  counterpartyFactionName: string
}

export interface PerkTemplate {
  name: string
  description: string
  tags: string[]
}

export interface FactionTemplate {
  name: string
  description: string
  goals: string
  resources: number
  influence: number
  threatLevel: number
}

export interface ItemTemplate {
  name: string
  description: string
  tags: string[]
}

/**
 * PbtA Fantasy (Dungeon World style)
 */
export const FANTASY_TEMPLATE: CampaignTemplate = {
  id: 'pbta-fantasy',
  name: 'PbtA Fantasy Adventure',
  description: 'Classic fantasy adventure with dungeons, dragons, and magic',
  universe: 'High Fantasy',
  systemPrompt: `You are the Game Master for a PbtA-style fantasy adventure.

**Core Principles:**
- Fiction first: The story drives the mechanics, not the other way around
- Be a fan of the characters: Root for them, make them awesome
- Fill their lives with adventure: Keep things exciting and dynamic
- Play to find out what happens: Don't plan outcomes, discover them together

**Fantasy World Elements:**
- Magic is real and dangerous
- Ancient ruins hold secrets and treasures
- Monsters are threats with goals and motivations
- Factions vie for power and influence

**GM Moves:**
- Reveal an unwelcome truth
- Show signs of approaching threat
- Deal damage
- Use up their resources
- Turn their move back on them
- Separate them
- Give an opportunity that fits a class' abilities
- Show a downside to their class, race, or equipment
- Offer an opportunity, with or without cost
- Put someone in a spot
- Tell them the requirements or consequences and ask`,

  initialWorldSeed: `The campaign begins in the frontier town of Thornhaven, nestled at the edge of the Whisperwood Forest. Strange lights have been seen in the ruins of the old wizard's tower to the north, and merchants report that the road to the capital has become dangerous.

The town council is worried, and adventurers are needed to investigate the threats and protect the town's interests.`,

  defaultPerks: [
    { name: 'Battle-Hardened', description: '+1 ongoing when fighting creatures you\'ve defeated before', tags: ['combat'] },
    { name: 'Lore Master', description: 'When you Spout Lore, on a 12+ you also discover a hidden advantage or opportunity', tags: ['knowledge'] },
    { name: 'Quick Reflexes', description: 'You always act first when danger strikes suddenly', tags: ['agility'] },
    { name: 'Silver Tongue', description: '+1 to Parley when you can offer something they want', tags: ['social'] }
  ],

  factionTemplates: [
    {
      name: 'The Circle of Thorns',
      description: 'A druidic order protecting the Whisperwood Forest from exploitation',
      goals: 'Preserve the ancient forest and its magical creatures',
      resources: 60,
      influence: 40,
      threatLevel: 2
    },
    {
      name: 'The Iron Company',
      description: 'Mercenary guild that controls trade routes and offers protection',
      goals: 'Expand influence and secure profitable contracts',
      resources: 70,
      influence: 60,
      threatLevel: 3
    },
    {
      name: 'The Shadowhand Thieves',
      description: 'Criminal network operating from the shadows of Thornhaven',
      goals: 'Control smuggling and information trading',
      resources: 50,
      influence: 45,
      threatLevel: 2
    }
  ],

  startingItems: [
    { name: 'Sword', description: 'A trusty blade (1d8 damage, close)', tags: ['weapon', 'melee'] },
    { name: 'Bow', description: 'A hunting bow (1d6 damage, near, far)', tags: ['weapon', 'ranged'] },
    { name: 'Leather Armor', description: 'Light protection (1 armor)', tags: ['armor'] },
    { name: 'Healing Potion', description: 'Restores 1d8 HP when consumed', tags: ['consumable', 'healing'] },
    { name: 'Adventuring Gear', description: 'Rope, torches, rations, and basic tools', tags: ['utility'] },
    { name: 'Spellbook', description: 'Contains three minor spells', tags: ['magic'] }
  ],

  frontTemplates: [
    {
      name: 'The Iron Company Tightens Its Grip',
      description: 'The mercenary guild is buying up debts and contracts across Thornhaven, positioning to control the town outright.',
      category: 'political',
      maxTicks: 6,
      consequence: 'The Iron Company forecloses on half the town — merchants answer to them now, not the council.',
      sourceFactionName: 'The Iron Company'
    },
    {
      name: 'Something Wakes in the Wizard\'s Tower',
      description: 'The lights in the old tower are getting brighter, and the tremors are getting closer to town.',
      category: 'supernatural',
      maxTicks: 8,
      consequence: 'Whatever was sealed in the tower breaks free and marches on Thornhaven.'
    }
  ],

  capabilityTemplates: [
    { domain: 'Swordplay', name: 'Bladework', description: 'Trained use of sword and shield in melee', tier: 1, isSecret: false },
    { domain: 'Swordplay', name: 'Riposte', description: 'Turning a parried blow into a killing counter', tier: 2, isSecret: false },
    { domain: 'Essence Magic', name: 'Cantrips', description: 'The minor spells every apprentice learns first', tier: 1, isSecret: false },
    { domain: 'Essence Magic', name: 'Ritual Casting', description: 'Slow, powerful magic worked outside combat', tier: 2, isSecret: false },
    { domain: 'Essence Magic', name: 'Blood Rites', description: 'Forbidden magic that trades the caster\'s vitality for power', tier: 3, isSecret: true },
    { domain: 'Woodcraft', name: 'Tracking', description: 'Reading trail-sign and predicting a quarry\'s path', tier: 1, isSecret: false },
    { domain: 'Woodcraft', name: 'Beast Speech', description: 'Communicating with the Whisperwood\'s creatures', tier: 2, isSecret: false }
  ],

  startingDebtTemplates: [
    {
      description: 'The Iron Company fronted your gear and travel coin — they expect it repaid, in service or in silver.',
      direction: 'owed_by_character',
      counterpartyFactionName: 'The Iron Company'
    }
  ],

  tags: ['fantasy', 'dungeon-crawl', 'magic', 'adventure']
}

/**
 * MHA: UA Arc - My Hero Academia Inspired
 */
export const MHA_UA_TEMPLATE: CampaignTemplate = {
  id: 'mha-ua-arc',
  name: 'MHA: UA Arc',
  description: 'Superhero training academy with quirks and heroic challenges',
  universe: 'Modern Superhero',
  systemPrompt: `You are the Game Master for a My Hero Academia-inspired campaign.

**Core Principles:**
- Plus Ultra: Characters should push beyond their limits
- Quirks define abilities but not character: Powers are tools, not personalities
- Heroism is learned: Characters grow through challenges and choices
- Villains have motivations: No one is purely evil

**World Elements:**
- 80% of population has quirks (superpowers)
- Hero society with rankings and agencies
- U.A. High School trains the next generation
- Villain activity is constant but controlled

**GM Moves:**
- Escalate a villain's plan
- Introduce a new quirk complication
- Put civilians in danger
- Challenge their hero ideals
- Reveal a hero's secret weakness
- Create a moral dilemma
- Show the cost of heroism`,

  initialWorldSeed: `You are students at U.A. High School, the most prestigious hero academy in Japan. Your first semester has just begun, and your homeroom teacher has announced a special exercise: a mock villain attack in the training facility.

But as you prepare for the exercise, alarms blare throughout the school. Real villains have somehow breached U.A.'s security. This is no longer a drill.`,

  defaultPerks: [
    { name: 'Quirk Evolution', description: 'Your quirk has developed a new application or aspect', tags: ['power'] },
    { name: 'Plus Ultra', description: 'Once per session, push past your limits for a guaranteed strong hit', tags: ['heroic'] },
    { name: 'Hero Network', description: 'You have contacts in the pro hero world who can provide assistance', tags: ['social'] }
  ],

  factionTemplates: [
    {
      name: 'League of Villains',
      description: 'Criminal organization seeking to destroy hero society',
      goals: 'Create chaos and prove heroes are frauds',
      resources: 55,
      influence: 50,
      threatLevel: 4
    },
    {
      name: 'Pro Hero Association',
      description: 'Official organization managing licensed heroes',
      goals: 'Maintain order and protect civilians',
      resources: 80,
      influence: 90,
      threatLevel: 1
    }
  ],

  startingItems: [
    { name: 'Hero Costume', description: 'Custom-made to enhance your quirk', tags: ['equipment'] },
    { name: 'Support Item', description: 'Gadget designed by the support department', tags: ['utility'] },
    { name: 'Provisional License', description: 'Allows hero work under supervision', tags: ['credential'] }
  ],

  frontTemplates: [
    {
      name: 'The League Recruits',
      description: 'The League of Villains is quietly pulling disaffected quirk-users into its ranks, growing faster than the Pro Hero Association can track.',
      category: 'villainy',
      maxTicks: 8,
      consequence: 'The League launches a coordinated strike on a hero agency — casualties are real, and public trust in heroes cracks.',
      sourceFactionName: 'League of Villains'
    },
    {
      name: 'Public Trust in Heroes Erodes',
      description: 'A string of botched rescues and a hostile press cycle are turning public opinion against licensed heroes.',
      category: 'social',
      maxTicks: 6,
      consequence: 'A ballot measure strips heroes of their authority to act without police sign-off — everything gets slower and more dangerous.'
    }
  ],

  capabilityTemplates: [
    { domain: 'Quirk Control', name: 'Basic Application', description: 'Using your quirk reliably, on command, without strain', tier: 1, isSecret: false },
    { domain: 'Quirk Control', name: 'Refined Technique', description: 'Precise, efficient use that costs you far less than a beginner\'s', tier: 2, isSecret: false },
    { domain: 'Quirk Control', name: 'Overdrive', description: 'Pushing your quirk past its safe limits — Plus Ultra, at a cost', tier: 3, isSecret: true },
    { domain: 'Combat Technique', name: 'Hero Basics', description: 'U.A.\'s foundational combat and rescue curriculum', tier: 1, isSecret: false },
    { domain: 'Combat Technique', name: 'Combo Work', description: 'Chaining your quirk with a weapon, gadget, or ally\'s power', tier: 2, isSecret: false },
    { domain: 'Support Engineering', name: 'Gear Maintenance', description: 'Keeping support-department gadgets running and tuned to your quirk', tier: 1, isSecret: false }
  ],

  startingDebtTemplates: [
    {
      description: 'The Pro Hero Association sponsored your provisional license — they expect results, and they\'re watching.',
      direction: 'owed_by_character',
      counterpartyFactionName: 'Pro Hero Association'
    }
  ],

  tags: ['superhero', 'school', 'modern', 'anime']
}

/**
 * Monster of the Week - Modern Horror
 */
export const MOTW_TEMPLATE: CampaignTemplate = {
  id: 'monster-of-the-week',
  name: 'Monster of the Week',
  description: 'Modern horror investigation with supernatural threats',
  universe: 'Modern Horror',
  systemPrompt: `You are the Game Master for a Monster of the Week style campaign.

**Core Principles:**
- Mysteries have solutions: Every monster can be defeated
- Investigation drives story: Clues lead to confrontation
- The mundane world is threatened: Protect ordinary people from supernatural horror
- Monsters are varied: Each threat is unique

**GM Moves:**
- Reveal a horrifying truth
- Endanger innocent bystanders
- Show evidence of the monster's power
- Make the monster's counter-move
- Create a moment of dread or suspense
- Separate the hunters
- Introduce a new threat or complication`,

  initialWorldSeed: `Strange deaths have been reported in the small town of Millbrook. The victims all died in their sleep, their faces frozen in expressions of terror. The local police are baffled, attributing the deaths to a rare cardiac condition.

But you know better. Something supernatural is hunting in Millbrook, and it's your job to stop it before more people die.`,

  defaultPerks: [
    { name: 'Monster Hunter', description: '+1 when tracking or fighting supernatural creatures', tags: ['combat'] },
    { name: 'Occult Library', description: 'You have access to rare lore about monsters', tags: ['knowledge'] },
    { name: 'Trust No One', description: 'You can sense when someone is lying or under supernatural influence', tags: ['investigation'] }
  ],

  factionTemplates: [
    {
      name: 'The Watchers',
      description: 'Secret organization dedicated to monitoring supernatural threats',
      goals: 'Catalog and contain supernatural entities',
      resources: 65,
      influence: 55,
      threatLevel: 2
    }
  ],

  startingItems: [
    { name: 'Silver Knife', description: 'Effective against many supernatural creatures (2 harm, hand)', tags: ['weapon', 'silver'] },
    { name: 'Research Notes', description: 'Information on common monster types', tags: ['knowledge'] },
    { name: 'Salt and Iron', description: 'Basic protective materials', tags: ['protection'] },
    { name: 'Investigation Kit', description: 'Camera, UV light, EMF detector', tags: ['utility'] }
  ],

  frontTemplates: [
    {
      name: 'The Deaths Continue',
      description: 'Millbrook\'s "cardiac" deaths are accelerating — the thing hunting here is getting bolder, or hungrier.',
      category: 'horror',
      maxTicks: 6,
      consequence: 'The monster claims someone the hunters know personally — and the town starts noticing the pattern.'
    },
    {
      name: 'The Watchers Move In',
      description: 'The Watchers have caught wind of Millbrook and are quietly deciding whether the hunters are an asset or a liability to contain.',
      category: 'political',
      maxTicks: 8,
      consequence: 'The Watchers pull rank, seize the hunters\' evidence, and take the case out of their hands entirely.',
      sourceFactionName: 'The Watchers'
    }
  ],

  capabilityTemplates: [
    { domain: 'Investigation', name: 'Fieldcraft', description: 'Reading a scene for evidence a normal investigator would miss', tier: 1, isSecret: false },
    { domain: 'Investigation', name: 'Occult Research', description: 'Tracing a monster back to its lore, weaknesses, and origin', tier: 2, isSecret: false },
    { domain: 'Combat', name: 'Hunter\'s Reflexes', description: 'Fighting something that shouldn\'t exist without freezing up', tier: 1, isSecret: false },
    { domain: 'Combat', name: 'Killing Blow', description: 'Knowing exactly where and how a given monster type actually dies', tier: 2, isSecret: false },
    { domain: 'The Sight', name: 'Glimpsing the Unnatural', description: 'Noticing wrongness other people\'s eyes slide past', tier: 1, isSecret: false },
    { domain: 'The Sight', name: 'Communion', description: 'Speaking with what hunts in the dark — on its terms, not yours', tier: 3, isSecret: true }
  ],

  startingDebtTemplates: [
    {
      description: 'The Watchers fed you the case file on Millbrook — in exchange, they expect a full report on whatever you find.',
      direction: 'owed_by_character',
      counterpartyFactionName: 'The Watchers'
    }
  ],

  tags: ['horror', 'investigation', 'modern', 'supernatural']
}

/**
 * All available templates
 */
export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  FANTASY_TEMPLATE,
  MHA_UA_TEMPLATE,
  MOTW_TEMPLATE
]

/**
 * Get template by ID
 */
export function getTemplate(id: string): CampaignTemplate | undefined {
  return CAMPAIGN_TEMPLATES.find(t => t.id === id)
}

export interface GeneratedFactionOverride {
  name: string
  description: string
  goals: string
  currentPlan?: string
  threatLevel: number
  resources: number
  influence: number
}

/**
 * Persist a set of factions for a new campaign. Shared by applyCampaignTemplate
 * (template campaigns) and the route handler directly (template-less/custom
 * universe campaigns) — factions aren't template-specific, so this doesn't
 * belong gated behind "did the user pick a template".
 */
export async function createFactionsForCampaign(
  campaignId: string,
  prisma: any,
  factions: GeneratedFactionOverride[]
): Promise<void> {
  for (const faction of factions) {
    await prisma.faction.create({
      data: {
        campaignId,
        name: faction.name,
        description: faction.description,
        goals: faction.goals,
        currentPlan: faction.currentPlan ?? null,
        resources: faction.resources,
        influence: faction.influence,
        threatLevel: faction.threatLevel
      }
    })
  }
}

export interface GeneratedNPCOverride {
  name: string
  description: string
  pronouns?: string
  importance: number
  goals?: string
  factionName?: string
}

export interface GeneratedLocationOverride {
  name: string
  description: string
  locationType?: string
  ownerFactionName?: string
}

/**
 * Persist notable NPCs for a new (or reseeded) campaign, resolving each
 * one's optional factionName against the campaign's already-created
 * factions by exact name (case-insensitive) — same pattern front-style
 * threats use for sourceFactionName. Unmatched names are simply dropped;
 * the NPC still gets created, just unaffiliated.
 */
export async function createNPCsForCampaign(
  campaignId: string,
  prisma: any,
  npcs: GeneratedNPCOverride[]
): Promise<void> {
  for (const npc of npcs) {
    let factionId: string | undefined
    if (npc.factionName) {
      const faction = await prisma.faction.findFirst({
        where: { campaignId, name: { equals: npc.factionName, mode: 'insensitive' } },
        select: { id: true },
      })
      factionId = faction?.id
    }
    await prisma.nPC.create({
      data: {
        campaignId,
        name: npc.name,
        description: npc.description,
        pronouns: npc.pronouns ?? null,
        importance: npc.importance,
        goals: npc.goals ?? null,
        factionId,
        factionRole: factionId ? 'MEMBER' : undefined,
      }
    })
  }
}

/**
 * Persist notable locations for a new (or reseeded) campaign, resolving
 * each one's optional ownerFactionName the same way createNPCsForCampaign
 * resolves factionName.
 */
export async function createLocationsForCampaign(
  campaignId: string,
  prisma: any,
  locations: GeneratedLocationOverride[]
): Promise<void> {
  for (const location of locations) {
    let ownerFactionId: string | undefined
    if (location.ownerFactionName) {
      const faction = await prisma.faction.findFirst({
        where: { campaignId, name: { equals: location.ownerFactionName, mode: 'insensitive' } },
        select: { id: true },
      })
      ownerFactionId = faction?.id
    }
    await prisma.location.create({
      data: {
        campaignId,
        name: location.name,
        description: location.description,
        locationType: location.locationType ?? null,
        ownerFactionId,
      }
    })
  }
}

/**
 * Apply template to a new campaign.
 * If generatedFactions is provided, those are used instead of the template's
 * hardcoded faction list (world seed is handled at the route level).
 *
 * hasGeneratedCapabilities: true when AI world generation already produced
 * a bespoke capability scaffold for this exact campaign — in that case
 * template.capabilityTemplates is skipped (the AI one takes precedence,
 * see campaigns/route.ts). False (or AI generation unavailable/failed)
 * means the template's scaffold becomes the real one, guaranteeing every
 * template campaign has a working capability tree even offline.
 *
 * hasGeneratedFronts: same fallback relationship, for front-style threats —
 * true when AI generation already produced bespoke (and, when lore was
 * imported, canon-grounded) fronts for this campaign, in which case
 * template.frontTemplates is skipped.
 */
export async function applyCampaignTemplate(
  campaignId: string,
  templateId: string,
  prisma: any,
  generatedFactions?: GeneratedFactionOverride[],
  hasGeneratedCapabilities = false,
  hasGeneratedFronts = false
): Promise<void> {
  const template = getTemplate(templateId)
  if (!template) {
    throw new Error(`Template ${templateId} not found`)
  }

  // Move flavor is no longer a template concept: it's generated per campaign
  // (templated or not) by lib/ai/moveFlavor.ts and persisted directly by the
  // caller (api/campaigns/route.ts) — see that generator's doc comment for
  // why a static per-template moveset was retired in favor of it.

  // Use AI-generated factions if available, otherwise fall back to template defaults
  const factionsToCreate = generatedFactions ?? template.factionTemplates.map(f => ({
    name: f.name,
    description: f.description,
    goals: f.goals,
    currentPlan: undefined as string | undefined,
    threatLevel: f.threatLevel,
    resources: f.resources,
    influence: f.influence,
  }))

  await createFactionsForCampaign(campaignId, prisma, factionsToCreate)

  // Front-style threats: ticking danger clocks with a stated consequence,
  // the same shape the world sim spawns organically from faction ambition
  // (see worldTurn.ts). sourceFactionName matches against template.
  // factionTemplates specifically — if AI factions replaced them, the name
  // won't resolve and the front is still created, just unlinked from a
  // faction (still a real threat, just not faction-attributed).
  if (!hasGeneratedFronts && template.frontTemplates && template.frontTemplates.length > 0) {
    for (const front of template.frontTemplates) {
      let relatedFactionId: string | undefined
      if (front.sourceFactionName) {
        const faction = await prisma.faction.findFirst({
          where: { campaignId, name: { equals: front.sourceFactionName, mode: 'insensitive' } },
          select: { id: true },
        })
        relatedFactionId = faction?.id
      }
      await prisma.clock.create({
        data: {
          campaignId,
          name: front.name,
          description: front.description,
          category: front.category,
          maxTicks: front.maxTicks,
          consequence: front.consequence,
          // relatedFactionId, NOT sourceFactionId — sourceFactionId opts a
          // clock out of the generic completion event (see the schema
          // comment) and into resolveCompletedAmbitions, which expects a
          // real tracked ambition and would otherwise misapply faction
          // stat deltas to this front when it completes.
          relatedFactionId,
        },
      })
    }
    console.log(`⏰ Seeded ${template.frontTemplates.length} front-style threats (template fallback)`)
  }

  // Capability scaffold fallback — see hasGeneratedCapabilities doc above.
  if (!hasGeneratedCapabilities && template.capabilityTemplates && template.capabilityTemplates.length > 0) {
    await prisma.campaignCapability.createMany({
      data: template.capabilityTemplates.map(c => ({
        campaignId,
        key: slugifyCapabilityKey(c.name),
        name: c.name,
        description: c.description,
        domain: c.domain,
        tier: c.tier,
        isSecret: c.isSecret,
      })),
      skipDuplicates: true,
    })
    console.log(`📖 Seeded ${template.capabilityTemplates.length} template capability nodes (AI scaffold unavailable)`)
  }

  console.log(`✅ Applied template: ${template.name} (${factionsToCreate.length} factions, ${generatedFactions ? 'AI-generated' : 'template defaults'})`)
}
