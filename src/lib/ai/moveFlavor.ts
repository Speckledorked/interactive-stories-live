// src/lib/ai/moveFlavor.ts
// Third-stage world generation: per-campaign flavor text for the fixed
// BASIC_MOVES set (lib/pbta-moves.ts). Runs alongside generateWorldExtras
// (same inputs, independent call) — kept separate rather than folded into
// either existing call because both of those are already tuned close to
// their own token budgets (see their doc comments), and a truncated
// response there zeroes out load-bearing content (factions/capabilities/
// fronts/archetypes), not just this. This call fails independently: no
// flavor text just means a campaign displays BASIC_MOVES' own generic
// name/trigger/outcome text, which is a fully functional baseline, not a
// degraded one — see the Move model's doc comment in schema.prisma.
//
// Mechanics never come from here: rollType/stat/outcome-band logic stays
// fixed in pbta-moves.ts and resolution.ts. This only ever supplies display
// text keyed by baseMoveKey, the same relationship statLabels has to the
// fixed stat keys.

import { openaiFetch } from '@/lib/ai/openaiCompat'
import { AI_MODELS } from './models'
import { BASIC_MOVES } from '@/lib/pbta-moves'
import type { GeneratedStatLabels } from './worldGenerator'

export interface GeneratedMoveFlavor {
  baseMoveKey: string
  name: string
  trigger: string
  description: string
  outcomes: {
    strongHit: string
    weakHit: string
    miss: string
  }
}

const VALID_KEYS = new Set(BASIC_MOVES.map(m => m.key))

const MOVE_LIST_FOR_PROMPT = BASIC_MOVES.map(
  m => `- "${m.key}" (mechanically "${m.name}", ${m.rollType}): ${m.trigger}. Bands: strong hit — ${m.outcomes.strongHit} / weak hit — ${m.outcomes.weakHit} / miss — ${m.outcomes.miss}`
).join('\n')

export async function generateMoveFlavor(
  campaignTitle: string,
  campaignDescription: string,
  universe: string,
  statLabels?: GeneratedStatLabels,
  // Imported-canon excerpts (lib/lore/loreDigest.ts) — when present, move
  // flavor should read like this canon's own vocabulary for these actions.
  loreDigest?: string
): Promise<GeneratedMoveFlavor[] | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const statLine = statLabels
    ? Object.entries(statLabels).map(([k, v]) => `${k} = "${v.label}"`).join(', ')
    : 'cool, hard, hot, sharp, weird (generic names)'

  const prompt = `You are renaming a tabletop RPG's core action moves to fit a specific campaign's voice, WITHOUT changing what they mechanically do.

Universe: ${universe}
Campaign: "${campaignTitle}"${campaignDescription ? `\nDescription: "${campaignDescription}"` : ''}
The 5 character stats in this world's vocabulary: ${statLine}
${loreDigest ? `\nCANON LORE — excerpts from this universe's actual source material. Ground the flavor in how this canon's fiction actually talks about these kinds of moments.\n<canon>\n${loreDigest}\n</canon>` : ''}

These are the fixed moves every character can attempt. Their MECHANICS (which stat, what a strong hit/weak hit/miss means structurally) never change — only the NAME, trigger wording, description, and outcome PROSE should be reworded to fit this campaign's voice:

${MOVE_LIST_FOR_PROMPT}

Return JSON:
{
  "moves": [
    {
      "base_move_key": "act_under_fire",
      "name": "This world's name for pushing through danger",
      "trigger": "Reworded trigger condition, same meaning, this world's vocabulary",
      "description": "1 sentence flavoring the same mechanic — do not restate the stat or roll math",
      "outcomes": {
        "strong_hit": "Flavored strong-hit text — same structural meaning as the original, new voice",
        "weak_hit": "Flavored weak-hit text — same structural meaning, new voice",
        "miss": "Flavored miss text — same structural meaning, new voice"
      }
    }
  ]
}

Rules:
- Exactly one entry per base_move_key listed above, using those exact keys
- Reword EVERYTHING (name, trigger, description, all three outcomes) to fit "${campaignTitle}" — a generic reskin that just swaps one noun isn't enough
- Never change what an outcome structurally grants (e.g. a strong hit is always the clean, no-cost version; a miss is always the GM's opening) — only how it's worded
- Keep each outcome to 1 short sentence, in-fiction, no meta-commentary about dice or mechanics
- name: 2-5 words, evocative, never the literal original move name`

  try {
    const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: AI_MODELS.EFFICIENT,
        messages: [
          {
            role: 'system',
            content: 'You reword tabletop RPG move flavor text to fit a campaign\'s voice without altering its mechanics. JSON only.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.9,
        max_tokens: loreDigest ? 2200 : 1800,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      console.error('Move flavor generation API error:', response.status)
      return null
    }

    const data = await response.json()
    const raw = JSON.parse(data.choices[0].message.content)
    if (!Array.isArray(raw.moves)) return null

    const flavors: GeneratedMoveFlavor[] = []
    const seenKeys = new Set<string>()
    for (const m of raw.moves) {
      const key = String(m?.base_move_key || '')
      if (!VALID_KEYS.has(key) || seenKeys.has(key)) continue
      if (!m?.name || !m?.trigger || !m?.outcomes) continue
      seenKeys.add(key)
      flavors.push({
        baseMoveKey: key,
        name: String(m.name),
        trigger: String(m.trigger),
        description: String(m.description || ''),
        outcomes: {
          strongHit: String(m.outcomes.strong_hit || ''),
          weakHit: String(m.outcomes.weak_hit || ''),
          miss: String(m.outcomes.miss || ''),
        },
      })
    }

    console.log(`✅ Move flavor: ${flavors.length}/${BASIC_MOVES.length} moves flavored`)
    return flavors
  } catch (err) {
    console.error('Move flavor generation failed (moves fall back to generic text):', err)
    return null
  }
}
