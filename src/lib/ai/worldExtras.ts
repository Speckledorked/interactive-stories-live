// src/lib/ai/worldExtras.ts
// Second-stage world generation: origin archetypes (playbook cards) and
// the corruption theme. Runs right after generateWorldFromTemplate at
// campaign creation, taking the freshly generated factions/capabilities/
// stat labels as input so archetypes reference real entities. Separate
// call because the main world-gen prompt is already at its token budget.
//
// Fail-open like the rest of world generation: null just means the
// campaign has no archetype cards (blank wizard still works) and/or no
// corruption track (which is also the CORRECT output for a universe whose
// fiction has no devil's-bargain concept — absence is a feature here).

import { openaiFetch } from '@/lib/ai/openaiCompat'
import { AI_MODELS } from './models'
import { validateStats } from '@/lib/game/advancement'
import { MAX_CORRUPTION, CorruptionTheme } from '@/lib/game/corruption'
import { slugifyCapabilityKey } from '@/lib/game/capabilities'
import type { GeneratedCapability, GeneratedStatLabels } from './worldGenerator'

export interface GeneratedArchetypeTie {
  kind: 'debt_owed_by_character' | 'debt_owed_to_character' | 'faction_standing'
  counterparty_type: 'npc' | 'faction'
  counterparty_name: string
  description: string
  standing_value?: number // only for faction_standing, -2..+2
}

export interface GeneratedArchetype {
  name: string
  description: string
  originFamiliarity: 'NATIVE' | 'NEWCOMER' | 'OUTSIDER'
  suggestedStats: Record<string, number> | null
  startingGear: {
    weapon?: string
    armor?: string
    misc?: string
    items?: Array<{ name: string; quantity: number; tags: string[] }>
  } | null
  startingTie: GeneratedArchetypeTie | null
  backstoryPrompts: string[]
  glimpseCapabilityKeys: string[]
}

export interface GeneratedWorldExtras {
  archetypes: GeneratedArchetype[]
  corruptionTheme: CorruptionTheme | null
}

interface FactionForExtras {
  name: string
  description: string
}

export async function generateWorldExtras(
  campaignTitle: string,
  campaignDescription: string,
  universe: string,
  factions: FactionForExtras[],
  capabilities: GeneratedCapability[],
  statLabels?: GeneratedStatLabels
): Promise<GeneratedWorldExtras | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const capabilityKeys = capabilities.map(c => `${slugifyCapabilityKey(c.name)} (${c.domain}, tier ${c.tier}${c.isSecret ? ', secret' : ''})`)
  const statLine = statLabels
    ? Object.entries(statLabels).map(([k, v]) => `${k} = "${v.label}"`).join(', ')
    : 'cool, hard, hot, sharp, weird (generic names)'

  const prompt = `You are designing character-creation content for a tabletop RPG campaign.

Universe: ${universe}
Campaign: "${campaignTitle}"${campaignDescription ? `\nDescription: "${campaignDescription}"` : ''}
Factions in this world: ${factions.length > 0 ? factions.map(f => f.name).join(', ') : 'none yet'}
Learnable systems (capability keys): ${capabilityKeys.length > 0 ? capabilityKeys.join('; ') : 'none yet'}
The 5 character stats in this world's vocabulary: ${statLine}

Produce two things as JSON:

{
  "archetypes": [
    {
      "name": "Evocative in-world archetype name",
      "description": "1-2 sentence pitch a new player reads on a card",
      "origin_familiarity": "NATIVE | NEWCOMER | OUTSIDER",
      "suggested_stats": {"cool": 0, "hard": 0, "hot": 0, "sharp": 0, "weird": 0},
      "starting_gear": {"weapon": "...", "armor": "...", "misc": "...", "items": [{"name": "...", "quantity": 1, "tags": ["..."]}]},
      "starting_tie": {"kind": "debt_owed_by_character | debt_owed_to_character | faction_standing", "counterparty_type": "npc | faction", "counterparty_name": "...", "description": "...", "standing_value": 1},
      "backstory_prompts": ["A question that helps the player write this archetype's backstory", "..."],
      "glimpse_capability_keys": ["capability-key-from-the-list-above"]
    }
  ],
  "corruption_theme": {
    "name": "What this universe calls its power-at-a-cost",
    "description": "2-3 sentences: what this force is and why drawing on it costs the self",
    "stages": ["stage 1 (subtle)", "stage 2", "stage 3", "stage 4", "stage 5 (the point of no return)"],
    "bargain_guidance": "1-2 sentences on when a bargain fits this world's fiction"
  }
}

Rules for archetypes:
- Exactly 4 archetypes, each a genuinely different way to enter this world (vary origin_familiarity across them — include at least one OUTSIDER-style entry if the universe supports newcomers)
- suggested_stats: use the 5 keys cool/hard/hot/sharp/weird with integer values -2..+3, TOTAL must equal exactly +2, at most ONE stat may be +2 or higher
- starting_tie: reference a REAL faction from the list above when counterparty_type is "faction"; invent a fitting named NPC otherwise. kind "faction_standing" uses standing_value between -2 and +2 (a disgraced origin can start negative)
- glimpse_capability_keys: 0-3 keys, chosen ONLY from the capability list above, never secret ones
- backstory_prompts: 2-3 questions each

Rules for corruption_theme — read carefully:
- Corruption is what THIS universe's fiction treats as a devil's bargain: power that changes or spends the self in ways the character cannot control or undo (forbidden rites, a god's invasive influence, knowledge that erodes the knower)
- NEVER define corruption by aesthetics. A dark/shadow/blood-affinity power set is NOT corruption — in many settings those are ordinary, even heroic, power sources. Do not pick something corrupting just because it sounds sinister
- If this universe's fiction has NO genuine power-at-a-cost concept, return null for corruption_theme. Returning null is a correct, expected answer — do not invent a corruption mechanic for a world that doesn't have one
- stages: exactly ${MAX_CORRUPTION} in-fiction descriptions of what each accumulated mark looks like from the inside, subtle to irreversible`

  try {
    const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: AI_MODELS.EFFICIENT,
        messages: [
          {
            role: 'system',
            content: 'You design tabletop RPG onboarding content in JSON. You follow structural rules exactly.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.9,
        max_tokens: 1600,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      console.error('World extras generation API error:', response.status)
      return null
    }

    const data = await response.json()
    const raw = JSON.parse(data.choices[0].message.content)

    const validCapabilityKeys = new Set(capabilities.filter(c => !c.isSecret).map(c => slugifyCapabilityKey(c.name)))
    const factionNames = new Set(factions.map(f => f.name.toLowerCase()))

    const archetypes: GeneratedArchetype[] = []
    if (Array.isArray(raw.archetypes)) {
      for (const a of raw.archetypes.slice(0, 5)) {
        if (!a?.name || !a?.description) continue

        // Stats must be a legal PbtA array or we drop them (the card still
        // works — the wizard just keeps its defaults).
        let suggestedStats: Record<string, number> | null = null
        if (a.suggested_stats && typeof a.suggested_stats === 'object') {
          const candidate: Record<string, number> = {}
          for (const key of ['cool', 'hard', 'hot', 'sharp', 'weird']) {
            candidate[key] = Number(a.suggested_stats[key]) || 0
          }
          if (validateStats(candidate).valid) suggestedStats = candidate
        }

        let startingTie: GeneratedArchetypeTie | null = null
        const tie = a.starting_tie
        if (
          tie?.kind && tie?.counterparty_name && tie?.description &&
          ['debt_owed_by_character', 'debt_owed_to_character', 'faction_standing'].includes(tie.kind) &&
          ['npc', 'faction'].includes(tie.counterparty_type)
        ) {
          // A faction tie must point at a real faction — an invented one
          // would seed a Debt/standing against nothing.
          if (tie.counterparty_type !== 'faction' || factionNames.has(String(tie.counterparty_name).toLowerCase())) {
            startingTie = {
              kind: tie.kind,
              counterparty_type: tie.counterparty_type,
              counterparty_name: String(tie.counterparty_name),
              description: String(tie.description),
              ...(tie.kind === 'faction_standing'
                ? { standing_value: Math.max(-2, Math.min(2, Number(tie.standing_value) || 1)) }
                : {}),
            }
          }
        }

        archetypes.push({
          name: String(a.name),
          description: String(a.description),
          originFamiliarity: ['NATIVE', 'NEWCOMER', 'OUTSIDER'].includes(a.origin_familiarity)
            ? a.origin_familiarity : 'NATIVE',
          suggestedStats,
          startingGear: a.starting_gear && typeof a.starting_gear === 'object' ? {
            weapon: a.starting_gear.weapon ? String(a.starting_gear.weapon) : undefined,
            armor: a.starting_gear.armor ? String(a.starting_gear.armor) : undefined,
            misc: a.starting_gear.misc ? String(a.starting_gear.misc) : undefined,
            items: Array.isArray(a.starting_gear.items)
              ? a.starting_gear.items
                  .filter((i: any) => i?.name)
                  .map((i: any) => ({
                    name: String(i.name),
                    quantity: Math.max(1, Number(i.quantity) || 1),
                    tags: Array.isArray(i.tags) ? i.tags.map(String) : [],
                  }))
              : undefined,
          } : null,
          startingTie,
          backstoryPrompts: Array.isArray(a.backstory_prompts) ? a.backstory_prompts.map(String).slice(0, 4) : [],
          glimpseCapabilityKeys: Array.isArray(a.glimpse_capability_keys)
            ? a.glimpse_capability_keys.map(String).filter((k: string) => validCapabilityKeys.has(k)).slice(0, 3)
            : [],
        })
      }
    }

    let corruptionTheme: CorruptionTheme | null = null
    const ct = raw.corruption_theme
    if (ct && typeof ct === 'object' && ct.name && ct.description && Array.isArray(ct.stages) && ct.stages.length > 0) {
      corruptionTheme = {
        name: String(ct.name),
        description: String(ct.description),
        stages: ct.stages.map(String).slice(0, MAX_CORRUPTION),
        bargainGuidance: ct.bargain_guidance ? String(ct.bargain_guidance) : undefined,
      }
    }

    console.log(`✅ World extras: ${archetypes.length} archetypes, corruption theme: ${corruptionTheme ? corruptionTheme.name : 'none (universe has no such concept)'}`)
    return { archetypes, corruptionTheme }
  } catch (err) {
    console.error('World extras generation failed (archetypes/corruption skipped):', err)
    return null
  }
}
