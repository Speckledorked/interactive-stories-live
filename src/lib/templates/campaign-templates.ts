// src/lib/templates/campaign-templates.ts
// Phase 18: Campaign Presets & Content Packs
// Pre-built system modules for quick campaign creation

export interface CampaignTemplate {
  id: string
  name: string
  description: string
  universe: string
  systemPrompt: string
  initialWorldSeed: string
  defaultMoves: MoveTemplate[]
  defaultPerks: PerkTemplate[]
  factionTemplates: FactionTemplate[]
  startingItems: ItemTemplate[]
  tags: string[]
}

export interface MoveTemplate {
  name: string
  trigger: string
  description: string
  rollType: string
  outcomes: {
    success: string
    partial: string
    miss: string
  }
  category: string
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

  defaultMoves: [
    {
      name: 'Defy Danger',
      trigger: 'When you act despite an imminent threat or suffer a calamity',
      description: 'Say how you deal with the danger. Roll+relevant stat.',
      rollType: 'variable',
      outcomes: {
        success: 'You do what you set out to do, and the threat doesn\'t come to bear.',
        partial: 'You stumble, hesitate, or flinch: the GM will offer you a worse outcome, hard bargain, or ugly choice.',
        miss: 'The danger manifests fully, and you may make things worse.'
      },
      category: 'basic'
    },
    {
      name: 'Hack and Slash',
      trigger: 'When you attack an enemy in melee',
      description: 'Roll+STR. You inflict your damage, but the enemy also makes an attack against you.',
      rollType: 'roll+STR',
      outcomes: {
        success: 'You deal your damage to the enemy and avoid their attack.',
        partial: 'You deal your damage, but the enemy also deals damage to you.',
        miss: 'The enemy makes an attack against you.'
      },
      category: 'basic'
    },
    {
      name: 'Volley',
      trigger: 'When you take aim and shoot at an enemy at range',
      description: 'Roll+DEX to attack from a distance.',
      rollType: 'roll+DEX',
      outcomes: {
        success: 'You have a clear shot - deal your damage.',
        partial: 'Choose one: You have to move to get the shot, placing yourself in danger; You have to take what you can get (reduce damage); You need several shots (use extra ammo).',
        miss: 'Your shot goes awry or puts you in danger.'
      },
      category: 'basic'
    },
    {
      name: 'Parley',
      trigger: 'When you press or entice an NPC',
      description: 'Roll+CHA to negotiate or persuade.',
      rollType: 'roll+CHA',
      outcomes: {
        success: 'They either do what you want or reveal the easiest way to convince them.',
        partial: 'They will do it, but need concrete assurance, corroboration, or evidence.',
        miss: 'They refuse, and may make demands or threats of their own.'
      },
      category: 'basic'
    },
    {
      name: 'Spout Lore',
      trigger: 'When you consult your accumulated knowledge about something',
      description: 'Roll+INT to recall useful information.',
      rollType: 'roll+INT',
      outcomes: {
        success: 'The GM will tell you something interesting and useful about the subject.',
        partial: 'The GM will tell you something interesting—it\'s on you to make it useful.',
        miss: 'The GM might tell you something interesting, but it comes with complications.'
      },
      category: 'basic'
    },
    {
      name: 'Discern Realities',
      trigger: 'When you closely study a situation or person',
      description: 'Roll+WIS to gain insight about your surroundings.',
      rollType: 'roll+WIS',
      outcomes: {
        success: 'Ask the GM 3 questions from the list.',
        partial: 'Ask 1 question from the list.',
        miss: 'Your investigation reveals something dangerous.'
      },
      category: 'basic'
    }
  ],

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

  defaultMoves: [
    {
      name: 'Use Your Quirk',
      trigger: 'When you activate your quirk to overcome an obstacle',
      description: 'Roll+the stat most relevant to your quirk.',
      rollType: 'variable',
      outcomes: {
        success: 'Your quirk works perfectly. Achieve your goal with flair.',
        partial: 'It works, but choose 1: Your quirk has an unexpected side effect; You push yourself too hard (take 1 harm); The situation escalates.',
        miss: 'Your quirk fails or backfires. The GM makes a hard move.'
      },
      category: 'basic'
    },
    {
      name: 'Save Someone',
      trigger: 'When you put yourself at risk to protect someone',
      description: 'Roll+Heart to heroically save another.',
      rollType: 'roll+Heart',
      outcomes: {
        success: 'You save them without consequences. The crowd is inspired.',
        partial: 'You save them, but you take harm or damage meant for them.',
        miss: 'You both end up in worse danger.'
      },
      category: 'basic'
    },
    {
      name: 'Read the Situation',
      trigger: 'When you assess a threat or tactical situation',
      description: 'Roll+Mind to analyze the battlefield.',
      rollType: 'roll+Mind',
      outcomes: {
        success: 'Ask 3 questions from the list: What\'s my best way in/out? Who\'s the biggest threat? What should I be on the lookout for?',
        partial: 'Ask 1 question.',
        miss: 'You misread the situation badly.'
      },
      category: 'basic'
    }
  ],

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

  defaultMoves: [
    {
      name: 'Investigate a Mystery',
      trigger: 'When you investigate a supernatural mystery',
      description: 'Roll+Sharp to uncover clues.',
      rollType: 'roll+Sharp',
      outcomes: {
        success: 'Ask the Keeper 2 questions from the investigation list.',
        partial: 'Ask 1 question, but you expose yourself to danger or attract attention.',
        miss: 'You find nothing useful, or you trigger a trap or alert.'
      },
      category: 'basic'
    },
    {
      name: 'Kick Some Ass',
      trigger: 'When you attack a monster or minion',
      description: 'Roll+Tough to fight the supernatural.',
      rollType: 'roll+Tough',
      outcomes: {
        success: 'You trade harm with the target. Choose effects: inflict terrible harm (+1 harm); suffer little harm (-1 harm received); force them where you want.',
        partial: 'You both take harm and it fights back.',
        miss: 'You are beaten up, captured, or put at the monster\'s mercy.'
      },
      category: 'basic'
    },
    {
      name: 'Protect Someone',
      trigger: 'When you prevent harm to another person',
      description: 'Roll+Tough to shield someone from danger.',
      rollType: 'roll+Tough',
      outcomes: {
        success: 'They are unharmed, and you suffer little harm.',
        partial: 'You protect them but suffer the harm in their place.',
        miss: 'You fail to protect them and you both suffer.'
      },
      category: 'basic'
    }
  ],

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

/**
 * Apply template to a new campaign
 */
export async function applyCampaignTemplate(
  campaignId: string,
  templateId: string,
  prisma: any
): Promise<void> {
  const template = getTemplate(templateId)
  if (!template) {
    throw new Error(`Template ${templateId} not found`)
  }

  // Create default moves
  for (const moveTemplate of template.defaultMoves) {
    await prisma.move.create({
      data: {
        campaignId,
        name: moveTemplate.name,
        trigger: moveTemplate.trigger,
        description: moveTemplate.description,
        rollType: moveTemplate.rollType,
        outcomes: moveTemplate.outcomes,
        category: moveTemplate.category
      }
    })
  }

  // Create faction templates
  for (const factionTemplate of template.factionTemplates) {
    await prisma.faction.create({
      data: {
        campaignId,
        name: factionTemplate.name,
        description: factionTemplate.description,
        goals: factionTemplate.goals,
        resources: factionTemplate.resources,
        influence: factionTemplate.influence,
        threatLevel: factionTemplate.threatLevel
      }
    })
  }

  console.log(`✅ Applied template: ${template.name}`)
}
