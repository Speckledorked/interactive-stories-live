// src/lib/ai/sceneIntro.ts
// Generate intro text for a brand new scene — the free-text (not
// JSON-schema) AI call that opens a fresh scene after the previous one
// resolved, moved out of worldState.ts.

import { reportError } from '@/lib/monitoring'
import { prisma } from '@/lib/prisma'
import { callChatCompletion } from '@/lib/ai/chatCompletion'
import { AI_MODELS } from './models'
import { recordAICost, estimateTokenCount } from './cost-tracker'
import { buildWorldSummaryForAI } from './worldSummary'
import { truncateWithEllipsis } from '@/lib/format'

/**
 * Generate intro text for a brand new scene
 * This is called when starting a fresh scene after the previous one resolved
 *
 * @param campaignId - Campaign ID
 * @returns AI-generated scene intro text
 */
export async function generateNewSceneIntro(campaignId: string, characterIds?: string[]): Promise<string> {
  console.log('🎭 Generating new scene intro')
  // A split-party or Character-Focused scene only introduces the
  // characters actually in it — otherwise every living character's
  // location/goals/threats bleed into an opener that's only supposed to
  // ground a subset of the party (see the doc comment on
  // buildOptimizedWorldSummary for the matching fix on ongoing resolution).
  const hasParticipants = Boolean(characterIds && characterIds.length > 0)

  // Lines and veils (see lib/safety/safety-service.ts) — this prompt is
  // built independently of buildSceneResolutionRequest's client.ts <safety>
  // section, so it needs its own instruction text below.
  const safetySettings = await prisma.campaignSafetySettings.findUnique({
    where: { campaignId },
    select: { lines: true, veils: true },
  })
  const lines = safetySettings?.lines ?? []
  const veils = safetySettings?.veils ?? []
  const safetyText = lines.length > 0 || veils.length > 0
    ? `\n\nCONTENT BOUNDARIES (override everything else, including genre conventions):${
        lines.length > 0 ? `\nHARD LINES — never include or approach, even obliquely: ${lines.join('; ')}` : ''
      }${
        veils.length > 0 ? `\nSOFT VEILS — may happen off-page, never described directly: ${veils.join('; ')}` : ''
      }`
    : ''

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      characters: {
        where: hasParticipants ? { isAlive: true, id: { in: characterIds } } : { isAlive: true },
        select: {
          name: true,
          pronouns: true,
          description: true,
          appearance: true,
          personality: true,
          goals: true,
          backstory: true,
          stats: true,
          inventory: true,
          equipment: true,
          resources: true,
          currentLocation: true,
          moves: true,
          perks: true,
          relationships: true,
          consequences: true
        }
      }
    }
  })

  if (!campaign) {
    throw new Error('Campaign not found')
  }

  const { worldSummary: worldSummaryData } = await buildWorldSummaryForAI(campaignId, hasParticipants ? characterIds! : null)

  // Get the last scene for context (could be RESOLVED or AWAITING_ACTIONS with resolutions)
  const lastScene = await prisma.scene.findFirst({
    where: {
      campaignId,
      OR: [
        { status: 'RESOLVED' },
        { sceneResolutionText: { not: null } }
      ]
    },
    orderBy: { sceneNumber: 'desc' }
  })

  // Offscreen fallout since the last scene resolved — the world keeps
  // ticking between scenes (world turns, faction ambitions, NPC moves) but
  // nothing forces it into view unless the opener reaches for it.
  // buildWorldSummaryForAI's recent_timeline_events mixes onscreen and
  // offscreen together with no distinction; this is a dedicated,
  // offscreen-only fetch so the opener can be told specifically "this
  // happened while nobody was looking."
  const offscreenFallout = lastScene
    ? await prisma.timelineEvent.findMany({
        where: {
          campaignId,
          isOffscreen: true,
          visibility: { in: ['PUBLIC', 'MIXED'] },
          createdAt: { gt: lastScene.updatedAt },
        },
        orderBy: { turnNumber: 'desc' },
        take: 3,
        select: { title: true, summaryPublic: true },
      })
    : []

  const offscreenFalloutText = offscreenFallout.length > 0
    ? `\n\nOFFSCREEN DEVELOPMENTS (happened in the world since the last scene, unseen by the party - the characters don't know these outright, but the atmosphere can carry a hint: a rumor overheard, a changed mood in the street, smoke where there wasn't any before):\n${offscreenFallout.map(e => `- ${e.title}: ${e.summaryPublic || 'details unclear'}`).join('\n')}`
    : ''

  const apiKey = process.env.OPENAI_API_KEY
  const startTime = Date.now()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  // Build focused character context - emphasize hooks, not stats
  const characterContext = campaign.characters.length > 0
    ? `\n\nPLAYER CHARACTERS:\n${campaign.characters.map(c => {
      const parts = [
        `\n## ${c.name}`,
        `Concept: ${c.description || 'A mysterious adventurer'}`,
      ]

      // Only include the most story-relevant details
      if (c.backstory && c.backstory.length > 20) {
        parts.push(`Background hint: ${truncateWithEllipsis(c.backstory, 80)}`)
      }

      // Lasting appearance/personality changes the fiction already wrote
      // (a scar, a trauma) are exactly the kind of hook a scene opener
      // should be able to reach for — surfaced here the same truncated way
      // backstory is above, not the full text.
      if (c.appearance && c.appearance.length > 20) {
        parts.push(`Appearance: ${truncateWithEllipsis(c.appearance, 80)}`)
      }

      if (c.personality && c.personality.length > 20) {
        parts.push(`Personality: ${truncateWithEllipsis(c.personality, 80)}`)
      }

      if (c.goals) {
        parts.push(`Current drive: ${c.goals}`)
      }

      // Location is important for scene setting
      if (c.currentLocation) {
        parts.push(`Location: ${c.currentLocation}`)
      }

      // Only mention significant equipment or consequences
      if (c.equipment) {
        const eq = c.equipment as any
        if (eq.weapon) parts.push(`Notable: ${eq.weapon.name || eq.weapon}`)
      }

      if (c.consequences) {
        const cons = c.consequences as any
        if (cons.enemies && cons.enemies.length > 0) {
          parts.push(`Threat: ${cons.enemies[0]}`) // Just the first enemy
        }
        if (cons.debts && cons.debts.length > 0) {
          parts.push(`Complication: ${cons.debts[0]}`) // Just the first debt
        }
      }

      return parts.join('\n  ')
    }).join('\n')}`
    : '\n\nNo player characters have been created yet.'

  // The campaign opener has no prior scene to be "mid-action" relative to —
  // dropping straight into a fight or chase here reads as arbitrary, not
  // tense, because nothing has grounded where the character even is yet.
  // Scene 2+ always follows a resolution that already established the
  // situation, so in-medias-res works there. Only the opener needs a
  // (brief) establishing beat before the hook.
  const isFirstScene = !lastScene

  // Everything above this point is written singular ("the character") —
  // fine for a solo opener, but with more than one PC it left the AI with
  // zero instruction for what to do when their locations/careers/goals
  // don't line up, and in practice that meant it just picked one character
  // and wrote an opener that never mentioned the rest at all. Spliced into
  // APPROACH below in both branches.
  const multiCharacterGuidance = campaign.characters.length > 1
    ? `\n\nMULTIPLE CHARACTERS: This scene has ${campaign.characters.length} characters — ground every one of them, not just whichever has the most detail in their sheet. If they share a location, open there together, already in each other's company. If their locations or careers differ, don't default to one and quietly drop the rest — find or invent a concrete, plausible reason they're together for this scene (a meeting arranged between them, a job that's pulled strangers together, a chance encounter that fits the setting and their goals). Every character listed under PLAYER CHARACTERS needs to actually be present and given something to react to by the end of the opening beat, not just be mentioned in passing or left out entirely.`
    : ''

  const openingGuidance = isFirstScene
    ? `**TONE & STYLE:**
- Open with a brief establishing beat: where the character is, what they're doing, what the place feels like — one or two sentences of real ground beneath their feet before anything else happens
- Show, don't tell - use vivid sensory details
- Once they're grounded, introduce something that demands a choice - tension, an arrival, a discovery
- Be subtle - weave in character details naturally, don't list them
- Match the tone of ${campaign.universe}

**WHAT TO INCLUDE:**
- A real place and moment the character can picture themselves standing in, before the hook lands
- Clear stakes - something starts to matter as the beat unfolds
- Hints at the character's background/goals through context, not exposition
- A dramatic question or choice that demands action by the end
- 2-3 paragraphs maximum

**WHAT TO AVOID:**
- Generic openings ("The heroes gather...", "Times are uncertain...")
- Starting mid-fight, mid-chase, or mid-crisis with zero setup — this is the character's first moment in the story, not their fiftieth
- Character introductions or descriptions
- Listing equipment, stats, or inventory
- Explaining backstories or goals directly
- Long exposition dumps
- "Your character feels/thinks/remembers" - stay external and immersive

**APPROACH:**
Start with the character somewhere concrete and grounded - their location if one is known, otherwise a place that fits their concept and the universe. Let the reader settle into that place for a beat. Then let the hook arrive: a stranger approaches, something goes wrong, a choice presents itself. If they have enemies or goals, let those color what "wrong" or "urgent" looks like. Setup, then stakes - not stakes with no setup.${multiCharacterGuidance}

Example: Instead of opening on a mid-swing sword fight, write "The tavern's back room smells of tallow and spilled ale. Three days he's waited at this table, and now the door creaks open" - then let the hook follow.`
    : `**TONE & STYLE:**
- Start with ACTION or ATMOSPHERE, not character introductions
- Show, don't tell - use vivid sensory details
- Create IMMEDIATE tension or intrigue
- Be subtle - weave in character details naturally, don't list them
- Match the tone of ${campaign.universe}

**WHAT TO INCLUDE:**
- A specific, compelling situation already in progress
- Clear stakes - something matters RIGHT NOW
- Hints at the character's background/goals through context, not exposition
- A dramatic question or choice that demands action
- 2-3 paragraphs maximum

**WHAT TO AVOID:**
- Generic openings ("The heroes gather...", "Times are uncertain...")
- Character introductions or descriptions
- Listing equipment, stats, or inventory
- Explaining backstories or goals directly
- Long exposition dumps
- "Your character feels/thinks/remembers" - stay external and immersive

**APPROACH:**
If they have a location, start there mid-scene. If they have enemies, maybe hint at danger. If they have goals, drop them into a situation that challenges those goals. But do it all through ATMOSPHERE and ACTION, not explanation.${offscreenFallout.length > 0 ? ' If any OFFSCREEN DEVELOPMENTS are listed below, let one of them color this scene\'s atmosphere - a detail, a mood, something glimpsed or overheard - so the world visibly moved while the party was elsewhere. Don\'t announce it as news; the characters don\'t know it as fact yet.' : ''}${multiCharacterGuidance}

Example: Instead of "You check your sword as you remember your oath of vengeance," write "The blade catches firelight from the distant campfires. Three days of tracking, and finally, smoke on the horizon."`

  const prompt = `You are the Game Master for a ${campaign.universe} campaign.

${campaign.aiSystemPrompt}

WORLD STATE:
${JSON.stringify(worldSummaryData, null, 2)}
${characterContext}

LAST SCENE RESOLUTION:
${lastScene?.sceneResolutionText || 'This is the first scene of the campaign. There is no prior action to continue from - the character has not yet set foot in the story.'}
${offscreenFalloutText}${safetyText}

Generate an engaging, atmospheric scene introduction that:

${openingGuidance}

Write ONLY the scene introduction. No JSON, no meta-commentary, no character sheets.`

  try {
    const result = await callChatCompletion({
      apiKey,
      model: AI_MODELS.FLAGSHIP, // Flagship model for scene intros - first impression shapes the whole session
      systemPrompt: 'You are an evocative, atmospheric storyteller and game master. You show, don\'t tell. You create tension through imagery and implication, not explanation.',
      userPrompt: prompt,
      temperature: 0.9, // Higher creativity for more varied, atmospheric openings
      maxTokens: 600, // Shorter, punchier scenes (2-3 paragraphs)
    })

    if (!result.ok) {
      throw new Error(`OpenAI API error: ${result.status}`)
    }

    const sceneIntro = result.content.trim()

    await recordAICost({
      campaignId,
      model: AI_MODELS.FLAGSHIP,
      requestType: 'scene_intro',
      inputTokens: result.usage.prompt_tokens || estimateTokenCount(prompt),
      outputTokens: result.usage.completion_tokens || estimateTokenCount(sceneIntro),
      responseTimeMs: Date.now() - startTime,
      success: true
    }).catch(console.error)

    console.log('✅ Scene intro generated:', sceneIntro.substring(0, 100) + '...')

    return sceneIntro
  } catch (error) {
    console.error('❌ Scene intro generation failed:', error)
    // The fallback below is what players see as the "generic opening" —
    // make sure the REASON reaches the error webhook, not just the logs.
    await reportError('scene-intro-generation-failed', error, { campaignId })

    // Fallback scene intro if AI fails - include character names if available
    const characterNames = campaign.characters.map(c => c.name).join(', ')
    const fallbackIntro = characterNames
      ? `${characterNames} find themselves at a crossroads in the ${campaign.universe}. The path ahead is shrouded in uncertainty, but action is required. What will ${campaign.characters.length > 1 ? 'they' : characterNames} do?`
      : `The story begins in the ${campaign.universe}. Danger and opportunity await in equal measure. What will you do?`

    return fallbackIntro
  }
}
