import { openaiFetch } from '@/lib/ai/openaiCompat'
/**
 * AI World Generator
 *
 * Generates a unique campaign world at creation time based on a template's
 * genre and tone, informed by the campaign title and description.
 * Each campaign gets its own world seed, faction names, goals, and current
 * plans — nothing is reused verbatim between campaigns.
 */

import { AI_MODELS } from './models'

interface GeneratedFaction {
  name: string
  description: string
  goals: string
  currentPlan: string
  threatLevel: number  // 1-5
  resources: number    // 10-100
  influence: number    // 10-100
}

export interface GeneratedCapability {
  domain: string // top-level system grouping, e.g. "Essence Magic"
  name: string
  description: string
  tier: number // 1 = entry knowledge, 3 = deep art
  isSecret: boolean // hidden even from natives until the fiction reveals it
}

// Fiction-flavored display name for one of the 5 fixed PbtA stat keys.
// The key itself (cool/hard/hot/sharp/weird) and its numeric meaning never
// change — this only changes what players see it called.
export interface GeneratedStatLabel {
  label: string
  description: string
}

export type GeneratedStatLabels = Record<'cool' | 'hard' | 'hot' | 'sharp' | 'weird', GeneratedStatLabel>

interface GeneratedWorld {
  worldSeed: string
  factions: GeneratedFaction[]
  // The universe's latent capability scaffold — what CAN be learned here.
  // Characters discover it through the fiction (see lib/game/capabilities.ts).
  capabilities: GeneratedCapability[]
  statLabels?: GeneratedStatLabels
}

const GENRE_HINTS: Record<string, string> = {
  'pbta-fantasy':         'High fantasy. Dungeons, ruins, magic, rival factions, ancient threats.',
  'mha-ua-arc':           'Modern superhero academy. Quirks, villain organizations, hero rankings, public safety.',
  'monster-of-the-week':  'Contemporary horror. Small towns, supernatural predators, secret hunter networks, skeptical authorities.',
}

/**
 * Generate a faction set, capability scaffold, fiction-flavored stat
 * labels, and (only when the caller doesn't already have one) a world
 * seed for a new campaign. Works for both a known template (templateId
 * looks up a genre hint) and a fully custom universe (pass the campaign's
 * free-text universe description as customUniverse — used as the genre
 * hint instead). Falls back to null on failure — caller uses
 * template/generic defaults instead.
 *
 * existingWorldSeed: pass the user's own hand-written world seed, if they
 * gave one — the AI still generates factions/capabilities/stat labels
 * grounded in it, it just doesn't invent a competing world_seed of its
 * own (the caller discards that field when this is set).
 */
export async function generateWorldFromTemplate(
  templateId: string | null,
  campaignTitle: string,
  campaignDescription: string,
  customUniverse?: string,
  existingWorldSeed?: string
): Promise<GeneratedWorld | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const genreHint = (templateId && GENRE_HINTS[templateId])
    || (customUniverse ? `Genre: ${customUniverse}` : 'Genre: original fictional world.')

  const prompt = `You are creating a unique campaign world for a tabletop RPG.

Genre: ${genreHint}
Campaign title: "${campaignTitle}"
${campaignDescription ? `Campaign description: "${campaignDescription}"` : ''}
${existingWorldSeed ? `The GM already wrote this opening situation — treat it as canon and ground everything you generate in it (don't contradict it, don't invent a competing one):\n"${existingWorldSeed}"` : ''}

Generate a fresh, specific starting world for this exact campaign. Use the title, description${existingWorldSeed ? ', and opening situation' : ''} as inspiration — the world should feel tailored to them, not generic.

Return JSON with this structure:
{
  "world_seed": "${existingWorldSeed ? "Restate the GM's own opening situation above, verbatim or near-verbatim — this field is discarded by the caller either way, so just echo it back." : "2-3 paragraphs. A specific opening situation already in motion — not 'adventure awaits' but something concrete happening right now. Name real places, factions, and tensions specific to this campaign."}",
  "factions": [
    {
      "name": "Unique faction name",
      "description": "1-2 sentences on who they are",
      "goals": "What they want long-term",
      "current_plan": "What they are actively doing right now to advance those goals",
      "threat_level": 1,
      "resources": 50,
      "influence": 50
    }
  ],
  "capability_domains": [
    {
      "domain": "Name of a learnable system in this world (a magic tradition, a fighting style, a political art...)",
      "capabilities": [
        { "name": "A specific learnable ability/art within the domain", "description": "1 sentence", "tier": 1, "is_secret": false }
      ]
    }
  ],
  "stat_labels": {
    "cool": { "label": "This world's name for keeping your head under pressure", "description": "1 short phrase" },
    "hard": { "label": "This world's name for aggressive, forceful capability", "description": "1 short phrase" },
    "hot": { "label": "This world's name for charm, presence, and social power", "description": "1 short phrase" },
    "sharp": { "label": "This world's name for perception, wit, and intellect", "description": "1 short phrase" },
    "weird": { "label": "This world's name for connection to the strange/supernatural/exotic", "description": "1 short phrase" }
  }
}

Rules:
- world_seed: 150-250 words, specific and atmospheric, names real locations and tensions
- factions: 2-4 factions, each with a unique name that fits the genre
- threat_level: 1 (minor) to 5 (existential). Not everyone should be a 4 or 5
- resources and influence: integers 10-90
- current_plan: 1-2 sentences, specific and active (e.g. "Bribing city guards to look the other way while they move contraband through the docks")
- Do NOT reuse names from generic fantasy/superhero tropes (no "The Dark Brotherhood", "League of Shadows", etc.)
- capability_domains: 3-5 domains, the learnable SYSTEMS of this world (its magic/powers/martial/social arts). 2-4 capabilities per domain. tier 1 = what any practitioner starts with, tier 2-3 = deeper arts. Mark 1-2 capabilities is_secret: true (forbidden or lost arts nobody openly knows)
- stat_labels: rename all 5 stats to fit this world's own vocabulary (e.g. a cultivation setting might call "weird" something like "Essence Sense"; a hard sci-fi setting might not use mystical language at all). Keep each label 1-3 words, in-fiction, never the literal PbtA name. The underlying meaning (what each stat measures) must stay the same — only the name and flavor change
- Make it feel like it belongs specifically to "${campaignTitle}"`

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
            content: 'You are a creative tabletop RPG world builder. You produce specific, evocative campaign worlds in JSON. Every world you create is unique.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.95,
        max_tokens: 1000,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      console.error('World generation API error:', response.status)
      return null
    }

    const data = await response.json()
    const raw = JSON.parse(data.choices[0].message.content)

    // Validate and normalise
    if (!raw.world_seed || !Array.isArray(raw.factions)) {
      console.error('World generation returned unexpected shape:', Object.keys(raw))
      return null
    }

    const factions: GeneratedFaction[] = raw.factions.map((f: any) => ({
      name: String(f.name || 'Unknown Faction'),
      description: String(f.description || ''),
      goals: String(f.goals || ''),
      currentPlan: String(f.current_plan || ''),
      threatLevel: Math.max(1, Math.min(5, Number(f.threat_level) || 2)),
      resources: Math.max(10, Math.min(90, Number(f.resources) || 50)),
      influence: Math.max(10, Math.min(90, Number(f.influence) || 50)),
    }))

    // Capability scaffold is optional — an older-style response without it
    // still produces a valid world (nodes then get created organically
    // mid-story via is_new capability_changes).
    const capabilities: GeneratedCapability[] = []
    if (Array.isArray(raw.capability_domains)) {
      for (const d of raw.capability_domains) {
        const domain = String(d?.domain || '').trim()
        if (!domain || !Array.isArray(d.capabilities)) continue
        for (const c of d.capabilities) {
          if (!c?.name) continue
          capabilities.push({
            domain,
            name: String(c.name),
            description: String(c.description || ''),
            tier: Math.max(1, Math.min(3, Number(c.tier) || 1)),
            isSecret: Boolean(c.is_secret),
          })
        }
      }
    }

    // Stat labels are optional — an older-style response or a partial one
    // still produces a valid world; missing/malformed keys fall back to the
    // generic PBTA_STATS label for that stat (see lib/pbta-moves.ts).
    const STAT_KEYS = ['cool', 'hard', 'hot', 'sharp', 'weird'] as const
    let statLabels: GeneratedStatLabels | undefined
    if (raw.stat_labels && typeof raw.stat_labels === 'object') {
      const built: Partial<GeneratedStatLabels> = {}
      for (const key of STAT_KEYS) {
        const entry = raw.stat_labels[key]
        if (entry?.label) {
          built[key] = { label: String(entry.label), description: String(entry.description || '') }
        }
      }
      if (Object.keys(built).length > 0) {
        statLabels = built as GeneratedStatLabels
      }
    }

    console.log(`✅ Generated unique world: ${factions.length} factions, ${capabilities.length} capabilities`)
    return { worldSeed: String(raw.world_seed), factions, capabilities, statLabels }

  } catch (err) {
    console.error('World generation failed, using template defaults:', err)
    return null
  }
}
