import { openaiFetch } from '@/lib/ai/openaiCompat'
// src/lib/downtime/ai-downtime-service.ts

import { prisma } from '@/lib/prisma'
import { NotificationService } from '@/lib/notifications/notification-service'
import { PusherServer } from '@/lib/realtime/pusher-server'
import { AI_MODELS } from '@/lib/ai/models'
import { parseDowntimeRewards, applyDowntimeRewards } from './downtimeRewards'
import { applyCapabilityChanges, CapabilityChange } from '@/lib/game/capabilities'
import { applyDebtChanges } from '@/lib/game/debts'
import { decideDowntimeDayEvent, decideDowntimeOutcomeCategory, describeOutcomeConstraint, DowntimeEventOutcome } from './downtimeEventOutcome'
import { isUniqueConstraintViolation } from '@/lib/game/worldUpdaters/uniqueConstraintGuard'

// What a downtime activity actually costs — not always gold. The AI picks
// whichever of these genuinely fit the described activity (any subset, or
// none); each present one is mechanically charged in createDynamicActivity,
// not just displayed as flavor text.
export interface DowntimeCosts {
  gold?: number // 0/absent if none
  items?: Array<{ name: string; quantity: number }> // materials consumed from Character.inventory
  favor?: { counterparty_name: string; counterparty_type: 'npc' | 'faction'; description: string } | null // incurs a Debt owed BY the character
  requiresQuest?: { name: string; description: string; givenBy?: string | null } | null // spawns a real, tracked Quest
}

export interface DynamicDowntimeActivity {
  id: string
  characterId: string
  playerDescription: string // What the player actually wants to do
  aiInterpretation: {
    summary: string
    estimatedDuration: number
    costs: DowntimeCosts
    requirements: string[]
    skillsInvolved: string[]
    riskLevel: 'low' | 'medium' | 'high'
    potentialOutcomes: string[]
  }
  progressDays: number
  status: 'active' | 'completed' | 'interrupted'
  events: DynamicDowntimeEvent[]
  outcomes?: any
  createdAt: Date
  completedAt?: Date
}

export interface DynamicDowntimeEvent {
  id: string
  day: number
  title: string
  description: string
  choices?: Array<{
    option: string
    description: string
    consequences: string
  }>
  playerResponse?: string
  aiResponse?: string
  resolvedAt?: Date
}

export class AIDrivenDowntimeService {

  // Interpret any player downtime description using AI
  static async interpretDowntimeActivity(
    characterId: string,
    playerDescription: string,
    campaignContext?: any
  ) {
    try {
      const character = await prisma.character.findUnique({
        where: { id: characterId },
        include: {
          campaign: true,
          user: true
        }
      })

      if (!character) {
        throw new Error('Character not found')
      }

      const resources = (character.resources as any) || {}
      const gold = resources.gold || 0
      const inventory = (character.inventory as any)?.items || []
      const inventoryText = inventory.length > 0
        ? inventory.map((i: any) => `${i.name}${i.quantity ? ` x${i.quantity}` : ''}`).join(', ')
        : 'Nothing notable'

      const prompt = `As MythOS, interpret this player's downtime activity request:

Player Description: "${playerDescription}"

Character Context:
- Name: ${character.name}
- Background: ${character.backstory || 'Unknown'}
- Current Location: ${character.currentLocation || campaignContext?.currentLocation || 'Campaign setting'}
- Available Gold: ${gold}
- Inventory: ${inventoryText}

Campaign Context:
- Setting: ${character.campaign.universe || character.campaign.description?.slice(0, 100) || 'Fantasy'}
- Current State: ${campaignContext?.currentState || 'Between adventures'}
- Recent Events: ${campaignContext?.recentEvents || 'None specified'}

Analyze this request and return a JSON object with:
{
  "summary": "Clear description of what the character will do",
  "estimatedDuration": number (days, 1-365),
  "costs": {
    "gold": number (0 if this costs no money),
    "items": [{"name": "existing inventory item name", "quantity": number}] (materials/components CONSUMED from the character's own inventory listed above — only ever items they actually have; empty array if none consumed),
    "favor": {"counterparty_name": "an NPC or faction name", "counterparty_type": "npc"|"faction", "description": "what favor is being spent"} or null (set this when the cost is political/social — pulling strings, calling in a favor, using up goodwill with someone specific. This makes the character owe them one; null if no favor is spent),
    "requiresQuest": {"name": "short quest name", "description": "what the character must go do", "givenBy": "who tasked them, or null"} or null (set this ONLY when the activity cannot be resolved by downtime narration alone and genuinely requires the party to go undertake something in a real scene later — e.g. "forge a masterwork blade" needs rare ore fetched first. This spawns a tracked quest; null for anything downtime alone can resolve)
  },
  "requirements": ["what", "needs", "to", "happen", "first"],
  "skillsInvolved": ["relevant", "character", "skills"],
  "riskLevel": "low|medium|high",
  "potentialOutcomes": ["possible", "positive", "results"],
  "potentialComplications": ["possible", "negative", "results"],
  "isViable": boolean (can this actually be done?),
  "aiNotes": "Any important considerations or modifications"
}

Costs are almost never just gold — pick whichever of gold/items/favor/requiresQuest actually fit what the character described, including several at once or none at all. A quiet afternoon of rest costs nothing. Training with a mentor might cost a favor instead of coin. Crafting consumes materials. Only charge what the fiction actually justifies.

Make the interpretation:
1. Realistic for the character's level and resources
2. Appropriate for the campaign setting
3. Engaging and meaningful for character development
4. Flexible enough to allow player agency

If the request seems impossible, suggest a viable alternative.`

      const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: AI_MODELS.EFFICIENT,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.6,
          max_tokens: 800
        })
      })

      const data = await response.json()
      const interpretation = JSON.parse(data.choices[0].message.content)

      if (!interpretation.isViable) {
        return {
          success: false,
          suggestion: interpretation.aiNotes,
          interpretation
        }
      }

      return {
        success: true,
        interpretation
      }
    } catch (error) {
      console.error('Error interpreting downtime activity:', error)
      
      // Fallback interpretation
      return {
        success: true,
        interpretation: {
          summary: `Attempt to: ${playerDescription}`,
          estimatedDuration: 7,
          costs: { gold: 0, items: [], favor: null, requiresQuest: null } as DowntimeCosts,
          requirements: ["Determine feasibility"],
          skillsInvolved: ["General"],
          riskLevel: 'medium',
          potentialOutcomes: ["Learn something new", "Make progress"],
          potentialComplications: ["Unexpected challenges"],
          isViable: true,
          aiNotes: "AI interpretation failed, using basic activity"
        }
      }
    }
  }

  // Create a downtime activity from player description
  static async createDynamicActivity(
    characterId: string,
    playerDescription: string,
    campaignContext?: any
  ) {
    // #211: at most one ACTIVE downtime activity per character — without
    // this, a player could stack unlimited concurrent activities, each
    // independently completing and granting its own rewards. Checked before
    // the AI interpretation call so a rejection doesn't spend it needlessly.
    // A real partial unique index (see the migration) backstops the race
    // between two concurrent requests both passing this check.
    const existingActive = await prisma.downtimeActivity.findFirst({
      where: { characterId, status: 'ACTIVE' },
      select: { id: true, summary: true },
    })
    if (existingActive) {
      throw new Error(`You already have an active downtime activity in progress: "${existingActive.summary}". Finish or advance it before starting another.`)
    }

    const interpretationResult = await this.interpretDowntimeActivity(
      characterId,
      playerDescription,
      campaignContext
    )

    if (!interpretationResult.success) {
      throw new Error(`Cannot create activity: Activity is not viable`)
    }

    const interpretation = interpretationResult.interpretation
    const costs: DowntimeCosts = interpretation.costs || {}

    // Charge whatever the activity actually costs, now, at commitment — the
    // UI shows these as real costs, not flavor text. Rejects (before
    // touching anything) if gold or items are unaffordable; favor and
    // requiresQuest are never "unaffordable" — they're forward-looking
    // obligations, not resources that run out.
    const { extraRequirements, linkedQuestId } = await this.chargeDowntimeCosts(characterId, costs, interpretation.summary)

    // Create the activity using the correct schema fields. The DB-level
    // partial unique index (see migration) is the backstop for a race
    // between two concurrent requests both passing the pre-check above —
    // narrow, but the costs above are already charged by the time this
    // runs, so a caught violation here surfaces a clear message rather
    // than a raw constraint error, even though it can't un-charge them.
    let activity
    try {
      activity = await prisma.downtimeActivity.create({
        data: {
          characterId,
          summary: interpretation.summary,
          description: playerDescription, // Store original player intent
          estimatedDays: interpretation.estimatedDuration,
          currentDay: 0,
          costs: costs as any,
          requirements: [...interpretation.requirements, ...extraRequirements],
          skillsInvolved: interpretation.skillsInvolved,
          riskLevel: interpretation.riskLevel,
          linkedQuestId,
          outcomes: {
            potentialOutcomes: interpretation.potentialOutcomes,
            aiInterpretation: interpretation
          },
          status: 'ACTIVE'
        }
      })
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new Error('Another activity was started for this character at the same moment — you already have an active downtime activity in progress.')
      }
      throw error
    }

    // Generate initial events for the activity
    await this.generateInitialEvents(activity.id, interpretation)

    return activity
  }

  // Checks affordability and charges every cost type an activity carries.
  // All-or-nothing: gold/item affordability is checked before anything is
  // mutated, so a shortfall on either never leaves a partial charge behind.
  private static async chargeDowntimeCosts(
    characterId: string,
    costs: DowntimeCosts,
    activitySummary: string
  ): Promise<{ extraRequirements: string[]; linkedQuestId: string | null }> {
    const goldCost = costs.gold || 0
    const itemCosts = costs.items || []

    const character = await prisma.character.findUnique({
      where: { id: characterId },
      select: { name: true, campaignId: true, resources: true, inventory: true },
    })
    if (!character) throw new Error('Character not found')

    const currentResources: any = (character.resources as any) || {}
    const currentGold = currentResources.gold || 0
    if (goldCost > 0 && currentGold < goldCost) {
      throw new Error(`Not enough gold for this activity (needs ${goldCost}, have ${currentGold})`)
    }

    const currentInventory: any = (character.inventory as any) || { items: [] }
    const items: any[] = currentInventory.items || []
    for (const need of itemCosts) {
      const have = items.find((i: any) => i.name?.toLowerCase() === need.name.toLowerCase())
      if (!have || (have.quantity ?? 1) < need.quantity) {
        throw new Error(`Not enough ${need.name} for this activity (needs ${need.quantity}, have ${have?.quantity ?? 0})`)
      }
    }

    if (goldCost > 0 || itemCosts.length > 0) {
      for (const need of itemCosts) {
        const item = items.find((i: any) => i.name?.toLowerCase() === need.name.toLowerCase())
        item.quantity = (item.quantity ?? 1) - need.quantity
      }
      const remainingItems = items.filter((i: any) => (i.quantity ?? 1) > 0)

      await prisma.character.update({
        where: { id: characterId },
        data: {
          ...(goldCost > 0 ? { resources: { ...currentResources, gold: currentGold - goldCost } } : {}),
          ...(itemCosts.length > 0 ? { inventory: { ...currentInventory, items: remainingItems } } : {}),
        },
      })
    }

    const extraRequirements: string[] = []
    let linkedQuestId: string | null = null

    if (costs.favor) {
      const worldMeta = await prisma.worldMeta.findUnique({
        where: { campaignId: character.campaignId },
        select: { currentTurnNumber: true },
      })
      await applyDebtChanges(
        prisma,
        character.campaignId,
        characterId,
        character.name,
        [{
          counterparty_name: costs.favor.counterparty_name,
          counterparty_type: costs.favor.counterparty_type,
          direction: 'owed_by_character',
          action: 'incur',
          description: costs.favor.description,
          reason: `Cost of downtime activity: ${activitySummary}`,
        }],
        worldMeta?.currentTurnNumber ?? 0
      )
      extraRequirements.push(`Owes ${costs.favor.counterparty_name} a favor: ${costs.favor.description}`)
    }

    if (costs.requiresQuest) {
      const quest = await prisma.quest.create({
        data: {
          campaignId: character.campaignId,
          name: costs.requiresQuest.name,
          description: costs.requiresQuest.description,
          givenBy: costs.requiresQuest.givenBy || null,
          status: 'ACTIVE',
        },
      })
      linkedQuestId = quest.id
      extraRequirements.push(`Requires completing the quest: "${costs.requiresQuest.name}"`)
    }

    return { extraRequirements, linkedQuestId }
  }

  // Generate AI events for any type of activity. forcedOutcome — decided
  // server-side by decideDowntimeDayEvent/decideDowntimeOutcomeCategory
  // BEFORE this is called — constrains what the AI is allowed to narrate,
  // the same "dice decide how well, AI decides how" split scene resolution
  // already uses. Falls back to unconstrained generation only if the
  // caller genuinely has no roll (shouldn't happen via the real call
  // sites below, but keeps this function safe to call standalone).
  static async generateDynamicEvent(
    activityId: string,
    day: number,
    interpretation: any,
    character?: any,
    campaignContext?: any,
    forcedOutcome?: DowntimeEventOutcome | null
  ) {
    try {
      const activity = await prisma.downtimeActivity.findUnique({
        where: { id: activityId }
      })

      if (!activity) return null

      const outcome = forcedOutcome ?? decideDowntimeOutcomeCategory(activityId, day, activity.riskLevel)

      const prompt = `Generate a downtime event for day ${day} of this activity:

Activity: ${activity.summary}
Original Player Intent: ${activity.description}
AI Interpretation: ${JSON.stringify(interpretation)}

Character: ${character?.name || 'Adventurer'}
Campaign Context: ${JSON.stringify(campaignContext) || 'Standard fantasy'}

${describeOutcomeConstraint(outcome)}

Create an engaging event that:
1. Relates to the specific activity the player described
2. Feels natural and realistic for day ${day} of ${activity.estimatedDays}
3. May require player input or be purely narrative
4. Fits the required outcome category above — the category is fixed, not a suggestion
5. Respects player agency and the AI's interpretation

Return a JSON object:
{
  "title": "Event title",
  "description": "What happens - be specific and engaging",
  "eventType": "progress|complication|opportunity|discovery|encounter|setback",
  "requiresPlayerChoice": boolean,
  "choices": [
    {
      "option": "Choice 1",
      "description": "What this choice means",
      "consequences": "Likely outcome"
    }
  ] (only if requiresPlayerChoice is true),
  "automaticOutcome": "What happens if no choice needed",
  "skillCheck": "relevant skill if any",
  "narrative": "Rich narrative description for immersion"
}`

      const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: AI_MODELS.EFFICIENT,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 600
        })
      })

      const data = await response.json()
      const eventData = JSON.parse(data.choices[0].message.content)

      const event = await prisma.downtimeEvent.create({
        data: {
          activityId,
          dayNumber: day,
          eventText: eventData.narrative || eventData.description,
          choices: eventData.requiresPlayerChoice ? {
            choices: eventData.choices || [],
            automaticOutcome: eventData.automaticOutcome
          } : undefined,
          outcomeCategory: outcome
        }
      })

      return event
    } catch (error) {
      console.error('Error generating dynamic event:', error)

      // Fallback to simple event
      const activity = await prisma.downtimeActivity.findUnique({
        where: { id: activityId }
      })

      return await prisma.downtimeEvent.create({
        data: {
          activityId,
          dayNumber: day,
          eventText: `You continue working on your activity: ${activity?.summary || 'your downtime'}`,
          choices: undefined,
          outcomeCategory: forcedOutcome ?? null
        }
      })
    }
  }

  // Process player response to dynamic events
  static async respondToDynamicEvent(
    eventId: string,
    playerResponse: string,
    campaignContext?: any
  ) {
    const event = await prisma.downtimeEvent.findUnique({
      where: { id: eventId },
      include: {
        activity: true
      }
    })

    if (!event) {
      throw new Error('Event not found')
    }

    const prompt = `As MythOS, respond to the player's choice for this downtime event:

Event: Day ${event.dayNumber}
Description: ${event.eventText}
Available Choices: ${JSON.stringify(event.choices || {})}

Player Response: "${playerResponse}"

Activity Context: ${event.activity.summary} (${event.activity.description})

Generate a response that:
1. Acknowledges the player's choice
2. Describes immediate consequences
3. Shows how it affects the ongoing activity
4. Maintains narrative consistency
5. Sets up potential future developments

Respond in an engaging, narrative style as MythOS. Keep it to 2-3 paragraphs.`

    try {
      const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: AI_MODELS.EFFICIENT,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 400
        })
      })

      const data = await response.json()
      const aiResponse = data.choices[0].message.content

      // Update event with player response and outcome
      await prisma.downtimeEvent.update({
        where: { id: eventId },
        data: {
          response: playerResponse,
          outcome: aiResponse,
          respondedAt: new Date()
        }
      })

      return {
        playerResponse,
        aiResponse,
        event
      }
    } catch (error) {
      console.error('Error generating AI response:', error)
      return {
        playerResponse,
        aiResponse: "Your choice is noted, and the activity continues...",
        event
      }
    }
  }

  // Advance time for all activities with dynamic processing
  static async advanceDynamicDowntime(characterId: string, days: number = 1) {
    // #312/#327: DowntimeActivity has no relation field to Character (just
    // a plain characterId scalar, no @relation — see schema.prisma), so
    // this can't be expressed as a nested `character: { isAlive: true }`
    // filter the way the tick pipeline's isAlive-gated queries can.
    // Defense in depth at the service layer regardless of what the calling
    // route already checked — a character who died elsewhere in the
    // campaign after starting a multi-day activity should not have it
    // silently keep advancing and paying out.
    const character = await prisma.character.findUnique({ where: { id: characterId }, select: { isAlive: true } })
    if (!character?.isAlive) return []

    const activeActivities = await prisma.downtimeActivity.findMany({
      where: {
        characterId,
        status: 'ACTIVE'
      },
      include: {
        events: true
      }
    })

    const results = []

    // #305: retry any already-COMPLETED activity whose outcome generation
    // failed last time (AI outage/malformed response) — this is the only
    // path back in, since the ACTIVE-only query above never sees a
    // COMPLETED row again. Retried before the day-advancement loop so a
    // long-silent lost reward gets a chance to resolve as soon as the
    // player next touches downtime at all, not just when they happen to
    // have another ACTIVE activity too.
    const failedOutcomeActivities = await prisma.downtimeActivity.findMany({
      where: { characterId, status: 'COMPLETED', outcomeGenerationFailedAt: { not: null } },
    })
    for (const activity of failedOutcomeActivities) {
      const aiInterpretation = (activity.outcomes as any)?.aiInterpretation || {}
      const outcomes = await this.generateDynamicOutcomes(activity.id, activity.description, aiInterpretation)
      results.push({
        activityId: activity.id,
        activityName: activity.summary,
        completed: true,
        outcomes
      })
    }

    for (const activity of activeActivities) {
      // costs.requiresQuest (see ai-downtime-service.ts's DowntimeCosts)
      // spawned a real, linked Quest — the activity can't actually finish
      // until that quest resolves, however many days pass. A failed/
      // abandoned quest fails the activity outright rather than leaving it
      // stalled forever with no way to close it.
      if (activity.linkedQuestId) {
        const quest = await prisma.quest.findUnique({
          where: { id: activity.linkedQuestId },
          select: { status: true, name: true },
        })
        if (quest && (quest.status === 'FAILED' || quest.status === 'ABANDONED')) {
          await prisma.downtimeActivity.update({
            where: { id: activity.id },
            data: { status: 'FAILED', completedAt: new Date() },
          })
          results.push({
            activityId: activity.id,
            activityName: activity.summary,
            completed: true,
            outcomes: { primaryOutcome: `Fell through — the linked quest "${quest.name}" was ${quest.status.toLowerCase()}.` },
          })
          continue
        }
        if (quest && quest.status === 'ACTIVE') {
          // Blocked on the quest: let days (and their events) still pass,
          // but never let the activity actually cross the finish line.
          const blockedDay = Math.min(activity.currentDay + days, activity.estimatedDays - 1)
          await prisma.downtimeActivity.update({
            where: { id: activity.id },
            data: { currentDay: Math.max(activity.currentDay, blockedDay) },
          })
          for (let day = activity.currentDay + 1; day <= blockedDay; day++) {
            const dayDecision = decideDowntimeDayEvent(activity.id, day, activity.riskLevel)
            if (dayDecision.hasEvent) {
              const aiInterpretation = (activity.outcomes as any)?.aiInterpretation || {}
              const event = await this.generateDynamicEvent(activity.id, day, aiInterpretation, null, null, dayDecision.outcome)
              if (event) {
                results.push({ activityId: activity.id, activityName: activity.summary, day, event })
              }
            }
          }
          continue
        }
        // quest.status === 'COMPLETED' (or the quest was somehow deleted)
        // falls through to normal progress/completion below.
      }

      const newCurrentDay = Math.min(
        activity.currentDay + days,
        activity.estimatedDays
      )
      const willComplete = newCurrentDay >= activity.estimatedDays

      // #304: two concurrent PUT /dynamic-downtime calls for the same
      // final-day activity (double-click, client retry, two open tabs)
      // could both read this activity as ACTIVE, both flip it to
      // COMPLETED, and both independently run generateDynamicOutcomes'
      // reward application below. Guarded the same way Quest completion
      // (#212), advancementVersion bumps (#214), and clock batches (#229)
      // already do: an updateMany scoped to the status this call actually
      // read, with the affected-row count deciding whether this call
      // "won" the race to complete it.
      let wonCompletionRace = true
      if (willComplete) {
        const result = await prisma.downtimeActivity.updateMany({
          where: { id: activity.id, status: 'ACTIVE' },
          data: { currentDay: newCurrentDay, status: 'COMPLETED', completedAt: new Date() },
        })
        wonCompletionRace = result.count > 0
        if (!wonCompletionRace) {
          console.warn(`  ⚠️ downtime activity "${activity.summary}": already completed by a concurrent request — skipping duplicate reward application`)
        }
      } else {
        await prisma.downtimeActivity.update({
          where: { id: activity.id },
          data: { currentDay: newCurrentDay },
        })
      }

      // Process each day that advanced
      for (let day = activity.currentDay + 1; day <= newCurrentDay; day++) {
        // Deterministic (riskLevel-weighted) chance of an event each day —
        // see decideDowntimeDayEvent. Same ~40% base rate as before, now
        // reproducible instead of a bare Math.random() coin flip.
        const dayDecision = decideDowntimeDayEvent(activity.id, day, activity.riskLevel)
        if (dayDecision.hasEvent) {
          const aiInterpretation = (activity.outcomes as any)?.aiInterpretation || {}
          const event = await this.generateDynamicEvent(
            activity.id,
            day,
            aiInterpretation,
            null,
            null,
            dayDecision.outcome
          )

          if (event) {
            results.push({
              activityId: activity.id,
              activityName: activity.summary,
              day,
              event
            })
          }
        }
      }

      // Generate completion outcomes if activity is finished — and this
      // call actually won the race to complete it (#304).
      if (willComplete && wonCompletionRace) {
        const aiInterpretation = (activity.outcomes as any)?.aiInterpretation || {}
        const outcomes = await this.generateDynamicOutcomes(
          activity.id,
          activity.description,
          aiInterpretation
        )

        // Deliberate practice is the fast lane for capability growth: a
        // completed activity whose skillsInvolved name an UNLOCKED
        // capability applies one training-channel gain to it (2x scene
        // gain, still arc-capped). Names that match nothing are skipped by
        // the writer — vague skill strings must not spawn junk nodes.
        const skills: string[] = aiInterpretation.skillsInvolved || []
        if (skills.length > 0) {
          try {
            const trainingLog = await this.applyTrainingGains(characterId, skills)
            for (const line of trainingLog) {
              console.log(`  📖 Training (${activity.summary}) — ${line}`)
            }
          } catch (error) {
            console.error('Failed to apply downtime training gains (non-critical):', error)
          }
        }

        results.push({
          activityId: activity.id,
          activityName: activity.summary,
          completed: true,
          outcomes
        })
      }
    }

    return results
  }

  // Training-channel capability growth from a completed downtime activity.
  // Matches skill names against the character's UNLOCKED capabilities only
  // — downtime can sharpen what you have, but unlocking something new has
  // to happen in the fiction (a scene), not in a progress bar.
  private static async applyTrainingGains(characterId: string, skills: string[]): Promise<string[]> {
    const character = await prisma.character.findUnique({
      where: { id: characterId },
      select: { campaignId: true }
    })
    if (!character) return []

    const worldMeta = await prisma.worldMeta.findUnique({
      where: { campaignId: character.campaignId },
      select: { currentTurnNumber: true }
    })
    const currentTurn = worldMeta?.currentTurnNumber ?? 0

    const changes: CapabilityChange[] = skills.map(skill => ({
      capability_key: skill,
      change: 'progress' as const,
      reason: 'Deliberate practice during downtime'
    }))

    return applyCapabilityChanges(
      prisma,
      character.campaignId,
      characterId,
      changes,
      currentTurn,
      'training'
    )
  }

  // Generate dynamic outcomes based on the player's original intent
  static async generateDynamicOutcomes(
    activityId: string,
    playerDescription: string,
    interpretation: any
  ) {
    try {
      const activity = await prisma.downtimeActivity.findUnique({
        where: { id: activityId },
        include: {
          events: true
        }
      })

      if (!activity) return null

      // DowntimeActivity has no campaignId of its own — reward application
      // (standing changes especially) is campaign-scoped, so resolve it
      // through the owning character.
      const owner = await prisma.character.findUnique({
        where: { id: activity.characterId },
        select: { campaignId: true }
      })

      const prompt = `Generate completion outcomes for this downtime activity:

Original Player Intent: "${playerDescription}"
AI Interpretation: ${JSON.stringify(interpretation)}
Activity Duration: ${activity.estimatedDays} days
Events that occurred: ${activity.events.length}

Based on the player's original intent and what happened during the activity, generate realistic outcomes:

{
  "primaryOutcome": "Main result description - what the player achieved",
  "skillProgress": {
    "skillsImproved": ["list", "of", "skills"],
    "experienceGained": number (10-100)
  },
  "materialRewards": {
    "goldGained": number,
    "itemsCreated": ["list", "of", "items"],
    "resourcesGained": ["list", "of", "resources"]
  },
  "relationships": {
    "contactsGained": ["list", "of", "new", "contacts"],
    "reputationChanges": ["faction: +/-change"]
  },
  "knowledge": {
    "informationLearned": ["list", "of", "things", "learned"],
    "secretsUncovered": ["list", "of", "secrets"]
  },
  "ongoingEffects": ["lasting", "consequences"],
  "futureOpportunities": ["new", "possibilities", "unlocked"],
  "narrative": "Rich description of what was accomplished"
}`

      const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: AI_MODELS.EFFICIENT,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.6,
          max_tokens: 600
        })
      })

      // #305: an unchecked non-2xx response used to fall straight through
      // to `data.choices[0].message.content`, throwing a confusing
      // TypeError on whatever error-shaped body OpenAI actually returned
      // — caught below the same as any other failure, but worth failing
      // fast and legibly here instead.
      if (!response.ok) {
        throw new Error(`Downtime outcome completion failed: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      const outcomes = JSON.parse(data.choices[0].message.content)
      // #305: unlike pc_changes (validateAIResponseWithRepair), this
      // payload had no shape check at all — a response missing the fields
      // this function and its caller actually read (primaryOutcome as the
      // player-facing summary, narrative as finalOutcome) would silently
      // persist a broken/empty completion rather than being treated as
      // the failure it is.
      if (typeof outcomes?.primaryOutcome !== 'string' || typeof outcomes?.narrative !== 'string') {
        throw new Error('Downtime outcome completion returned an unexpected shape')
      }

      // Update activity with outcomes and set final outcome
      await prisma.downtimeActivity.update({
        where: { id: activityId },
        data: {
          outcomes,
          finalOutcome: outcomes.narrative,
          // A retry (see advanceDynamicDowntime's own retry pass) landing
          // here means this attempt succeeded — clear any failure a prior
          // attempt recorded.
          outcomeGenerationFailedAt: null,
        }
      })

      // Apply what the activity actually earned (#74). This used to be a
      // dead pipe — the payload above was stored and never read, so a
      // downtime narrated as "+2 with the Thieves' Guild and 300 gold"
      // changed nothing on the sheet, even though the entry costs had been
      // charged for real on the way in. Best-effort: a reward-application
      // failure logs and leaves the activity completed rather than failing
      // the whole completion, matching how the rest of this service treats
      // its non-critical steps.
      try {
        if (owner) {
          const rewards = parseDowntimeRewards(outcomes)
          // #211: the arc-rarity item budget (applyGrantBudget) needs the
          // current turn to know what's already been granted this arc —
          // without it, item grants here would silently skip the budget
          // check entirely (see applyDowntimeRewards's own fallback).
          const worldMeta = await prisma.worldMeta.findUnique({
            where: { campaignId: owner.campaignId },
            select: { currentTurnNumber: true },
          })
          // #261: this activity's only possible in-fiction payer — the
          // faction that gave the quest costs.requiresQuest spawned, when
          // one was spawned and it resolved to a real faction giver. Most
          // activities have no linkedQuestId at all, in which case this
          // stays null and gold pays out exactly as it always did.
          let payerFactionId: string | null = null
          if (activity.linkedQuestId) {
            const linkedQuest = await prisma.quest.findUnique({
              where: { id: activity.linkedQuestId },
              select: { givenByFactionId: true },
            })
            payerFactionId = linkedQuest?.givenByFactionId ?? null
          }
          const rewardLog = await prisma.$transaction(async (tx) =>
            applyDowntimeRewards(tx, owner.campaignId, activity.characterId, activity.summary || 'downtime activity', rewards, worldMeta?.currentTurnNumber, payerFactionId)
          )
          for (const line of rewardLog) console.log(`  🎁 ${line}`)
        }
      } catch (rewardError) {
        console.error('⚠️  Failed to apply downtime rewards (non-critical):', rewardError)
      }

      return outcomes
    } catch (error) {
      console.error('Error generating dynamic outcomes:', error)
      // #305: this used to return a fake-success narrative here — the
      // activity was already committed COMPLETED by the caller before
      // this function ever ran, so an AI outage/malformed response meant
      // the player saw "success" while zero gold/items/standing/training
      // were ever applied, permanently (the reward loop only ever
      // touches status: ACTIVE activities, so a COMPLETED one had no path
      // back in). Recorded here instead so it's auditable and retriable —
      // advanceDynamicDowntime retries any activity carrying this flag on
      // the character's next downtime-advance call, and this same
      // function clears it the moment a retry actually succeeds.
      await prisma.downtimeActivity.update({
        where: { id: activityId },
        data: { outcomeGenerationFailedAt: new Date() },
      }).catch((markError) => {
        console.error('Failed to record downtime outcome-generation failure (non-critical):', markError)
      })
      return {
        primaryOutcome: "The activity concluded, but its results are still being tallied — check back shortly.",
        skillProgress: { experienceGained: 0 },
        narrative: "Something interrupted the reckoning of this activity's outcome. It will be resolved automatically.",
      }
    }
  }

  // Helper method to generate initial events
  private static async generateInitialEvents(activityId: string, interpretation: any) {
    // Generate 1-3 initial events throughout the activity duration
    const activity = await prisma.downtimeActivity.findUnique({
      where: { id: activityId }
    })

    if (!activity) return

    const eventDays = []

    // Always have a day 1 event to set the tone
    eventDays.push(1)

    // Add a mid-point event if duration > 7 days
    if (activity.estimatedDays > 7) {
      eventDays.push(Math.floor(activity.estimatedDays / 2))
    }

    // Add a late event if duration > 14 days
    if (activity.estimatedDays > 14) {
      eventDays.push(Math.floor(activity.estimatedDays * 0.8))
    }

    for (const day of eventDays) {
      // Guaranteed events (not chance-gated like advanceDynamicDowntime's
      // day-by-day ones) still deserve a real, deterministic category
      // rather than defaulting to whatever the AI feels like.
      const outcome = decideDowntimeOutcomeCategory(activityId, day, activity.riskLevel)
      await this.generateDynamicEvent(activityId, day, interpretation, null, null, outcome)
    }
  }

  // Get suggestions based on character and campaign context
  static async getPersonalizedSuggestions(characterId: string, campaignContext?: any): Promise<string[]> {
    const FALLBACK = [
      'Investigate the mysterious artifact we found last session',
      'Visit the local library to research our current quest',
      'Practice your combat skills with the city guards',
      'Build relationships with important NPCs we\'ve met',
      'Explore areas of the city we haven\'t visited yet',
    ]

    try {
      const character = await prisma.character.findUnique({
        where: { id: characterId },
        include: {
          campaign: true,
          capabilities: { include: { capability: true } },
        },
      })
      if (!character) return FALLBACK

      const resources = (character.resources as any) || {}
      const gold = resources.gold || 0

      const { summarizeCapabilities } = await import('@/lib/game/capabilities')
      const capabilitySummary = summarizeCapabilities(character.capabilities as any)
      const knownAbilities = capabilitySummary.known.map(k => `${k.name} (${k.band})`).join(', ') || 'None discovered yet'

      const lastScene = await prisma.scene.findFirst({
        where: { campaignId: character.campaignId, sceneResolutionText: { not: null } },
        orderBy: { sceneNumber: 'desc' },
        select: { sceneResolutionText: true },
      })

      const prompt = `As MythOS, suggest 5 downtime activities specific to this character. Not generic RPG filler — things that follow from who they are and what's actually happened in their story.

Character:
- Name: ${character.name}
- Concept: ${character.description || 'Unknown'}
- Backstory: ${character.backstory || 'Unknown'}
- Personality: ${character.personality || 'Unknown'}
- Goals: ${character.goals || 'Unknown'}
- Current location: ${character.currentLocation || campaignContext?.currentLocation || 'Unknown'}
- Known abilities: ${knownAbilities}
- Gold available: ${gold}

Campaign:
- Setting: ${character.campaign.universe || character.campaign.description?.slice(0, 150) || 'Original setting'}
${lastScene?.sceneResolutionText ? `- What just happened: ${lastScene.sceneResolutionText.slice(0, 500)}` : ''}
${campaignContext?.recentEvents ? `- Recent events: ${campaignContext.recentEvents}` : ''}

Return JSON: { "suggestions": ["activity 1", "activity 2", "activity 3", "activity 4", "activity 5"] }

Each suggestion:
- Written as something the PLAYER would type ("I ...")
- Follows from this specific character's backstory, goals, location, or what just happened — not a generic RPG downtime list
- One concrete sentence, no meta-commentary`

      const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: AI_MODELS.EFFICIENT,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.8,
          max_tokens: 500,
          response_format: { type: 'json_object' },
        }),
      })

      if (!response.ok) return FALLBACK

      const data = await response.json()
      const parsed = JSON.parse(data.choices[0].message.content)
      const suggestions = Array.isArray(parsed.suggestions)
        ? parsed.suggestions.filter((s: unknown) => typeof s === 'string' && s.trim()).slice(0, 5)
        : []

      return suggestions.length > 0 ? suggestions : FALLBACK
    } catch (error) {
      console.error('Error generating personalized downtime suggestions (falling back):', error)
      return FALLBACK
    }
  }
}
