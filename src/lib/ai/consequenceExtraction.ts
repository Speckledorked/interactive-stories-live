// src/lib/ai/consequenceExtraction.ts
//
// Extracts structured player-action consequences from a resolved scene:
// which NPC/Faction, what kind of action, and why. Follows the same
// structured-JSON-forcing pattern as worldGenerator.ts (raw fetch +
// response_format: json_object + manual validation/normalization) rather
// than inventing a new prompting approach or a Zod schema.

export const CONSEQUENCE_ACTIONS = [
  'SPARED',
  'KILLED',
  'BETRAYED',
  'FAVORED',
  'ROBBED',
  'HUMILIATED',
  'THREATENED',
  'RECRUITED',
  'SABOTAGED',
  'RESCUED',
] as const

export type ConsequenceAction = (typeof CONSEQUENCE_ACTIONS)[number]
export type ConsequenceIntensity = 'minor' | 'moderate' | 'major'
export type FactionGoalName = 'EXPAND' | 'DEFEND' | 'ENRICH' | 'DESTABILIZE_RIVAL' | 'CONSOLIDATE'

const FACTION_GOALS: FactionGoalName[] = ['EXPAND', 'DEFEND', 'ENRICH', 'DESTABILIZE_RIVAL', 'CONSOLIDATE']

export interface ExtractedConsequence {
  entityType: 'NPC' | 'FACTION'
  entityName: string
  action: ConsequenceAction
  reason: string
  intensity: ConsequenceIntensity
  updatedGoal?: string          // NPC only
  updatedRelationship?: string  // NPC only
  updatedFactionGoal?: FactionGoalName // FACTION only
}

interface KnownEntity {
  name: string
}

/**
 * Extract structured consequences from a resolved scene's text.
 *
 * Grounds the LLM in the campaign's actual NPC/Faction roster (the same
 * approach the main AI GM call already uses — buildWorldSummaryForAI sends
 * the full roster, not just scene participants) so it references real
 * names instead of inventing entities. Names are re-validated against the
 * roster again after the call, before anything gets applied.
 *
 * Non-critical: returns [] on any failure, same as enrichStubNPCs/enrichStubFactions.
 */
export async function extractConsequences(
  sceneText: string,
  knownNpcs: KnownEntity[],
  knownFactions: KnownEntity[]
): Promise<ExtractedConsequence[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return []

  // Nothing to ground against — skip the call rather than let the LLM invent entities.
  if (knownNpcs.length === 0 && knownFactions.length === 0) return []

  const npcList = knownNpcs.map(n => `- ${n.name}`).join('\n') || '(none)'
  const factionList = knownFactions.map(f => `- ${f.name}`).join('\n') || '(none)'

  const prompt = `You are analyzing a tabletop RPG scene for consequences of the players' actions toward NPCs and Factions.

SCENE TEXT:
${sceneText}

KNOWN NPCs IN THIS CAMPAIGN:
${npcList}

KNOWN FACTIONS IN THIS CAMPAIGN:
${factionList}

Identify any moments where the players' actions had a clear, specific consequence for one of these NPCs or Factions — sparing, killing, betraying, favoring, robbing, humiliating, threatening, recruiting, sabotaging, or rescuing them. Only reference NPCs/Factions from the lists above; do not invent new ones. Most scenes have zero consequences worth recording — only extract ones with a real, specific effect.

Return JSON with this structure:
{
  "consequences": [
    {
      "entity_type": "NPC",
      "entity_name": "exact name from the list above",
      "action": "SPARED",
      "reason": "1 sentence: what happened and why it matters",
      "intensity": "minor",
      "updated_goal": "optional: this NPC's goal now, only if it changed",
      "updated_relationship": "optional: this NPC's relationship to the party now, only if it changed"
    }
  ]
}

For FACTION entries, use "updated_faction_goal" instead of updated_goal/updated_relationship (one of: EXPAND, DEFEND, ENRICH, DESTABILIZE_RIVAL, CONSOLIDATE), only if their strategic goal clearly shifted because of this.

Rules:
- action must be exactly one of: ${CONSEQUENCE_ACTIONS.join(', ')}
- intensity: "minor" (background beat), "moderate" (notable), "major" (defining moment the campaign will remember)
- Only include entities that actually appear in the scene text with a clear consequence — don't stretch for content
- Returning an empty consequences array is the normal, expected result for most scenes`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: 'You extract structured, factual consequences from TTRPG scene text. You never invent entities not given to you. You are conservative — most scenes have zero or one consequence, not five.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 800,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      console.warn('⚠️ Consequence extraction API call failed:', response.status)
      return []
    }

    const data = await response.json()
    const raw = JSON.parse(data.choices[0].message.content)

    if (!Array.isArray(raw.consequences)) {
      return []
    }

    const knownNpcNames = new Set(knownNpcs.map(n => n.name.toLowerCase()))
    const knownFactionNames = new Set(knownFactions.map(f => f.name.toLowerCase()))
    const validActions = new Set<string>(CONSEQUENCE_ACTIONS)
    const validIntensities = new Set<string>(['minor', 'moderate', 'major'])
    const validFactionGoals = new Set<string>(FACTION_GOALS)

    const consequences: ExtractedConsequence[] = []

    for (const c of raw.consequences) {
      const entityType: 'NPC' | 'FACTION' | null =
        c.entity_type === 'FACTION' ? 'FACTION' : c.entity_type === 'NPC' ? 'NPC' : null
      const entityName = String(c.entity_name || '').trim()
      const action = String(c.action || '').toUpperCase()

      if (!entityType || !entityName || !validActions.has(action)) {
        console.warn('⚠️ Skipping malformed consequence:', c)
        continue
      }

      const knownSet = entityType === 'NPC' ? knownNpcNames : knownFactionNames
      if (!knownSet.has(entityName.toLowerCase())) {
        console.warn(`⚠️ Skipping consequence for unknown ${entityType}: ${entityName}`)
        continue
      }

      const intensity: ConsequenceIntensity = validIntensities.has(c.intensity) ? c.intensity : 'moderate'

      consequences.push({
        entityType,
        entityName,
        action: action as ConsequenceAction,
        reason: String(c.reason || '').slice(0, 500),
        intensity,
        updatedGoal: entityType === 'NPC' && c.updated_goal ? String(c.updated_goal).slice(0, 300) : undefined,
        updatedRelationship: entityType === 'NPC' && c.updated_relationship ? String(c.updated_relationship).slice(0, 300) : undefined,
        updatedFactionGoal: entityType === 'FACTION' && validFactionGoals.has(c.updated_faction_goal)
          ? (c.updated_faction_goal as FactionGoalName)
          : undefined,
      })
    }

    console.log(`✅ Extracted ${consequences.length} consequence(s)`)
    return consequences
  } catch (err) {
    console.warn('⚠️ Consequence extraction failed (non-critical):', err)
    return []
  }
}
