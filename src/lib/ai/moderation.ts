// src/lib/ai/moderation.ts
// Input moderation for player free-text before it reaches the LLM. This is
// provider-ToS protection (OpenAI requires flagged content not be sent to
// completion models), not the in-fiction safety tool — that's the X-Card
// system, which stays player-facing and unchanged.
//
// The moderation endpoint is free, so this adds latency but no cost.

const MODERATION_URL = 'https://api.openai.com/v1/moderations'
const MAX_MODERATION_INPUT = 8000

export interface ModerationResult {
  flagged: boolean
  categories: string[]
}

export type ModerationLevel = 'standard' | 'strict'

const CLEAN: ModerationResult = { flagged: false, categories: [] }

// Plain 'violence' is core, expected content in an adventure/combat RPG —
// OpenAI's moderation flags ordinary combat narration ("I swing my sword
// at the guard") the same as it would flag real-world violent content.
// Genuinely severe categories (graphic gore, sexual content involving
// minors, self-harm instructions, credible threats, extremist violence)
// are never exempted — only 'strict' campaigns opt back into blocking
// plain violence too.
const GENRE_EXEMPT_IN_STANDARD = new Set(['violence'])

/** Pure: pull the flagged verdict + offending category names out of the API response shape. */
export function parseModerationResponse(data: unknown): ModerationResult {
  const result = (data as any)?.results?.[0]
  if (!result) return CLEAN
  const categories = Object.entries(result.categories || {})
    .filter(([, flagged]) => flagged === true)
    .map(([name]) => name)
  return { flagged: Boolean(result.flagged), categories }
}

/** Pure: drop genre-exempt categories from the verdict unless the campaign runs strict moderation. */
export function applyModerationLevel(result: ModerationResult, level: ModerationLevel): ModerationResult {
  if (level === 'strict' || result.categories.length === 0) return result
  const categories = result.categories.filter(c => !GENRE_EXEMPT_IN_STANDARD.has(c))
  return { flagged: categories.length > 0, categories }
}

export async function moderatePlayerText(text: string, level: ModerationLevel = 'standard'): Promise<ModerationResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !text.trim()) return CLEAN

  try {
    const response = await fetch(MODERATION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'omni-moderation-latest',
        input: text.slice(0, MAX_MODERATION_INPUT),
      }),
    })

    if (!response.ok) {
      throw new Error(`Moderation API error: ${response.status}`)
    }

    return applyModerationLevel(parseModerationResponse(await response.json()), level)
  } catch (error) {
    // Fail open — a moderation outage shouldn't block gameplay. The
    // downstream completion call carries its own provider-side safety net.
    console.error('Moderation check failed (failing open):', error)
    return CLEAN
  }
}
