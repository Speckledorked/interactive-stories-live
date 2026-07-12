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

interface GeneratedWorld {
  worldSeed: string
  factions: GeneratedFaction[]
  // The universe's latent capability scaffold — what CAN be learned here.
  // Characters discover it through the fiction (see lib/game/capabilities.ts).
  capabilities: GeneratedCapability[]
}

const GENRE_HINTS: Record<string, string> = {
  'pbta-fantasy':         'High fantasy. Dungeons, ruins, magic, rival factions, ancient threats.',
  'mha-ua-arc':           'Modern superhero academy. Quirks, villain organizations, hero rankings, public safety.',
  'monster-of-the-week':  'Contemporary horror. Small towns, supernatural predators, secret hunter networks, skeptical authorities.',
}

/**
 * Generate a unique world seed and faction set for a new campaign.
 * Falls back to null on failure — caller uses template defaults instead.
 */
export async function generateWorldFromTemplate(
  templateId: string,
  campaignTitle: string,
  campaignDescription: string
): Promise<GeneratedWorld | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const genreHint = GENRE_HINTS[templateId] || 'Genre: original fictional world.'

  const prompt = `You are creating a unique campaign world for a tabletop RPG.

Genre: ${genreHint}
Campaign title: "${campaignTitle}"
${campaignDescription ? `Campaign description: "${campaignDescription}"` : ''}

Generate a fresh, specific starting world for this exact campaign. Use the title and description as inspiration — the world should feel tailored to them, not generic.

Return JSON with this structure:
{
  "world_seed": "2-3 paragraphs. A specific opening situation already in motion — not 'adventure awaits' but something concrete happening right now. Name real places, factions, and tensions specific to this campaign.",
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
  ]
}

Rules:
- world_seed: 150-250 words, specific and atmospheric, names real locations and tensions
- factions: 2-4 factions, each with a unique name that fits the genre
- threat_level: 1 (minor) to 5 (existential). Not everyone should be a 4 or 5
- resources and influence: integers 10-90
- current_plan: 1-2 sentences, specific and active (e.g. "Bribing city guards to look the other way while they move contraband through the docks")
- Do NOT reuse names from generic fantasy/superhero tropes (no "The Dark Brotherhood", "League of Shadows", etc.)
- capability_domains: 3-5 domains, the learnable SYSTEMS of this world (its magic/powers/martial/social arts). 2-4 capabilities per domain. tier 1 = what any practitioner starts with, tier 2-3 = deeper arts. Mark 1-2 capabilities is_secret: true (forbidden or lost arts nobody openly knows)
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

    console.log(`✅ Generated unique world: ${factions.length} factions, ${capabilities.length} capabilities`)
    return { worldSeed: String(raw.world_seed), factions, capabilities }

  } catch (err) {
    console.error('World generation failed, using template defaults:', err)
    return null
  }
}
