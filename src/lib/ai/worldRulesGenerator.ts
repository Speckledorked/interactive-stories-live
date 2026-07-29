// src/lib/ai/worldRulesGenerator.ts
// Integrity Engine Phase 4 — per-campaign semantic-invariant verdicts.
// Same fail-open shape as calendarGenerator.ts/worldExtras.ts: a failed or
// missing call just means the campaign falls back to every semantic
// check's unconditional default, which is always a safe state (see the
// schema comment on Campaign.worldRules).
//
// The AI is asked bounded yes/no questions against the closed catalogue in
// game/integrity/worldRules.ts — it never writes a predicate or invents a
// familyKey. parseWorldRules drops anything that doesn't match a
// registered family, so even a malformed or hallucinated response can't
// activate behavior nobody reviewed.

import { callChatCompletion } from './chatCompletion'
import { AI_MODELS } from './models'
import { SemanticCheckFamilyKey, WorldRule } from '@/lib/game/integrity/worldRules'

// The catalogue is closed and lives in worldRules.ts; this is just the
// prompt-facing description of each family the AI is allowed to rule on.
// Adding a family means adding both a real check gated on it AND an entry
// here — never one without the other.
const FAMILY_QUESTIONS: Record<SemanticCheckFamilyKey, string> = {
  'faction.leaderOptional':
    'In most settings, a faction/organization with living members must have exactly one living leader — a leaderless faction is a bug. Is that FALSE for this universe — does canon support factions that operate on purpose without a single leader (an anarchist collective, a hive mind, a council with no head, a long interregnum played as a real story beat)?',
}

interface RawGeneratedRule {
  family_key: string
  applies: boolean
  confidence: number
  rationale: string
}

/** What the generator hands back — sinceTurn/sourceLoreIds are filled in
 * by the caller (this module has no notion of the current turn or which
 * lore entries fed the digest). */
export interface GeneratedWorldRule {
  familyKey: SemanticCheckFamilyKey
  applies: boolean
  confidence: number
  rationale: string
}

function validateGeneratedRules(raw: unknown): GeneratedWorldRule[] | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.rules)) return null

  const knownKeys = new Set(Object.keys(FAMILY_QUESTIONS))
  const rules: GeneratedWorldRule[] = []
  for (const entry of r.rules as RawGeneratedRule[]) {
    if (!entry || typeof entry !== 'object') continue
    const familyKey = String((entry as any).family_key)
    if (!knownKeys.has(familyKey)) continue
    if (typeof entry.applies !== 'boolean') continue
    const confidence = Number(entry.confidence)
    if (!Number.isFinite(confidence)) continue
    rules.push({
      familyKey: familyKey as SemanticCheckFamilyKey,
      applies: entry.applies,
      confidence: Math.max(0, Math.min(1, confidence)),
      rationale: typeof entry.rationale === 'string' ? entry.rationale.trim() : '',
    })
  }
  return rules
}

export async function generateWorldRules(
  campaignTitle: string,
  campaignDescription: string,
  universe: string,
  loreDigest?: string
): Promise<GeneratedWorldRule[] | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const questions = Object.entries(FAMILY_QUESTIONS)
    .map(([key, question]) => `- "${key}": ${question}`)
    .join('\n')

  const prompt = `You are grounding a tabletop RPG world-simulation engine's invariant checks in this specific universe's fiction.

Universe: ${universe}
Campaign: "${campaignTitle}"${campaignDescription ? `\nDescription: "${campaignDescription}"` : ''}
${loreDigest ? `\nCanon excerpts:\n${loreDigest}\n` : ''}
Answer each of the following questions ONLY from what this universe's fiction actually supports — default to "applies": false (the normal-world assumption) unless canon clearly and specifically supports the exception. Do not invent lore to justify an exception.

${questions}

Return JSON:
{
  "rules": [
    { "family_key": "...", "applies": true or false, "confidence": 0.0 to 1.0, "rationale": "one sentence, grounded in the fiction above, or your general judgment if there is no lore excerpt" }
  ]
}

One entry per question above, every time — a confident "false" (the normal-world default) is exactly as valid an answer as a confident "true". confidence should be LOW (under 0.5) for a guess not clearly grounded in the material given.`

  try {
    const result = await callChatCompletion({
      apiKey,
      model: AI_MODELS.EFFICIENT,
      systemPrompt: 'You ground game-engine invariants in specific campaign fiction. JSON only. You never invent lore.',
      userPrompt: prompt,
      temperature: 0.3,
      maxTokens: 800,
      jsonMode: true,
    })

    if (!result.ok) {
      console.error('World rules generation API error:', result.status)
      return null
    }

    const raw = JSON.parse(result.content)
    const rules = validateGeneratedRules(raw)
    if (!rules) {
      console.error('World rules generation returned an invalid shape')
      return null
    }

    console.log(`✅ World rules generated: ${rules.length} verdict(s) (${rules.filter(r => r.applies).length} applying)`)
    return rules
  } catch (err) {
    console.error('World rules generation failed (campaign falls back to unconditional defaults):', err)
    return null
  }
}

export function generatedRulesToWorldRules(rules: GeneratedWorldRule[], sinceTurn: number): { rules: WorldRule[] } {
  return {
    rules: rules.map((r) => ({
      familyKey: r.familyKey,
      applies: r.applies,
      confidence: r.confidence,
      rationale: r.rationale,
      sinceTurn,
    })),
  }
}
