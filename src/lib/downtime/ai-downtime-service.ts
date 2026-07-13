import { openaiFetch } from '@/lib/ai/openaiCompat'
// src/lib/downtime/ai-downtime-service.ts

import { PrismaClient } from '@prisma/client'
import { NotificationService } from '@/lib/notifications/notification-service'
import { PusherServer } from '@/lib/realtime/pusher-server'
import { AI_MODELS } from '@/lib/ai/models'
import { applyCapabilityChanges, CapabilityChange } from '@/lib/game/capabilities'

const prisma = new PrismaClient()

export interface DynamicDowntimeActivity {
  id: string
  characterId: string
  playerDescription: string // What the player actually wants to do
  aiInterpretation: {
    summary: string
    estimatedDuration: number
    costs: { gold?: number; resources?: string[] }
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

      const prompt = `As an AI Game Master, interpret this player's downtime activity request:

Player Description: "${playerDescription}"

Character Context:
- Name: ${character.name}
- Experience: ${character.experience} XP
- Background: ${character.backstory || 'Unknown'}
- Current Location: ${character.currentLocation || campaignContext?.currentLocation || 'Campaign setting'}
- Available Gold: ${gold}

Campaign Context:
- Setting: ${character.campaign.universe || character.campaign.description?.slice(0, 100) || 'Fantasy'}
- Current State: ${campaignContext?.currentState || 'Between adventures'}
- Recent Events: ${campaignContext?.recentEvents || 'None specified'}

Analyze this request and return a JSON object with:
{
  "summary": "Clear description of what the character will do",
  "estimatedDuration": number (days, 1-365),
  "costs": {
    "gold": number (0 if no cost),
    "resources": ["list", "of", "materials"] (empty array if none)
  },
  "requirements": ["what", "needs", "to", "happen", "first"],
  "skillsInvolved": ["relevant", "character", "skills"],
  "riskLevel": "low|medium|high",
  "potentialOutcomes": ["possible", "positive", "results"],
  "potentialComplications": ["possible", "negative", "results"],
  "isViable": boolean (can this actually be done?),
  "aiNotes": "Any important considerations or modifications"
}

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
          costs: { gold: 0, resources: [] },
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
    const interpretationResult = await this.interpretDowntimeActivity(
      characterId,
      playerDescription,
      campaignContext
    )

    if (!interpretationResult.success) {
      throw new Error(`Cannot create activity: Activity is not viable`)
    }

    const interpretation = interpretationResult.interpretation

    // Note: Character gold tracking removed - can be added back if needed
    // For now, we assume the activity is affordable

    // Create the activity using the correct schema fields
    const activity = await prisma.downtimeActivity.create({
      data: {
        characterId,
        summary: interpretation.summary,
        description: playerDescription, // Store original player intent
        estimatedDays: interpretation.estimatedDuration,
        currentDay: 0,
        costs: {
          gold: interpretation.costs.gold || 0,
          resources: interpretation.costs.resources
        },
        requirements: interpretation.requirements,
        skillsInvolved: interpretation.skillsInvolved,
        riskLevel: interpretation.riskLevel,
        outcomes: {
          potentialOutcomes: interpretation.potentialOutcomes,
          aiInterpretation: interpretation
        },
        status: 'ACTIVE'
      }
    })

    // Generate initial events for the activity
    await this.generateInitialEvents(activity.id, interpretation)

    return activity
  }

  // Generate AI events for any type of activity
  static async generateDynamicEvent(
    activityId: string,
    day: number,
    interpretation: any,
    character?: any,
    campaignContext?: any
  ) {
    try {
      const activity = await prisma.downtimeActivity.findUnique({
        where: { id: activityId }
      })

      if (!activity) return null

      const prompt = `Generate a downtime event for day ${day} of this activity:

Activity: ${activity.summary}
Original Player Intent: ${activity.description}
AI Interpretation: ${JSON.stringify(interpretation)}

Character: ${character?.name || 'Adventurer'}
Campaign Context: ${JSON.stringify(campaignContext) || 'Standard fantasy'}

Create an engaging event that:
1. Relates to the specific activity the player described
2. Feels natural and realistic for day ${day} of ${activity.estimatedDays}
3. May require player input or be purely narrative
4. Advances the story or creates interesting complications/opportunities
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
          } : undefined
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
          choices: undefined
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

    const prompt = `As an AI Game Master, respond to the player's choice for this downtime event:

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

Respond in an engaging, narrative style as the AI Game Master. Keep it to 2-3 paragraphs.`

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

    for (const activity of activeActivities) {
      const newCurrentDay = Math.min(
        activity.currentDay + days,
        activity.estimatedDays
      )

      // Update progress
      await prisma.downtimeActivity.update({
        where: { id: activity.id },
        data: {
          currentDay: newCurrentDay,
          ...(newCurrentDay >= activity.estimatedDays ? {
            status: 'COMPLETED',
            completedAt: new Date()
          } : {})
        }
      })

      // Process each day that advanced
      for (let day = activity.currentDay + 1; day <= newCurrentDay; day++) {
        // 40% chance of an event each day (adjustable)
        if (Math.random() < 0.4) {
          const aiInterpretation = (activity.outcomes as any)?.aiInterpretation || {}
          const event = await this.generateDynamicEvent(
            activity.id,
            day,
            aiInterpretation,
            null,
            null
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

      // Generate completion outcomes if activity is finished
      if (newCurrentDay >= activity.estimatedDays) {
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

      const data = await response.json()
      const outcomes = JSON.parse(data.choices[0].message.content)

      // Update activity with outcomes and set final outcome
      await prisma.downtimeActivity.update({
        where: { id: activityId },
        data: {
          outcomes,
          finalOutcome: outcomes.narrative
        }
      })

      // Note: Character experience/gold rewards removed as Character model
      // doesn't have these fields. Can be added back if needed.

      return outcomes
    } catch (error) {
      console.error('Error generating dynamic outcomes:', error)
      return {
        primaryOutcome: "The activity was completed successfully.",
        skillProgress: { experienceGained: 10 },
        narrative: "Your efforts have paid off in ways both expected and surprising."
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
      await this.generateDynamicEvent(activityId, day, interpretation)
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

      const prompt = `As an AI Game Master, suggest 5 downtime activities specific to this character. Not generic RPG filler — things that follow from who they are and what's actually happened in their story.

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
