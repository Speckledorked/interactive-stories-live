// src/lib/ai/outcomeEchoRepair.ts
// Backstop for outcome adherence's 'unreported' case (see
// lib/game/outcomeAdherence.ts): the model wrote a scene but never echoed
// back which band it depicted for a rolled action, so the adherence check
// had nothing to compare against.
//
// This is deliberately NOT the same thing as validation.ts's
// validateAIResponseWithRepair — that repair round-trip only fires when the
// response fails Zod schema validation (a structurally broken response).
// outcome_echo is optional in the schema, so a response missing an entry is
// perfectly VALID — there's no validation failure to repair, just an
// incomplete self-report. This targets exactly that gap with its own small,
// separate follow-up call.
//
// Fails open at every step: no API key, an API error, or an answer that
// doesn't parse as one of the three real bands all leave the entry
// 'unreported' exactly as it would have been without this — this can only
// ever upgrade an 'unreported' verdict to 'match'/'mismatch', never invent
// or change anything else about the scene. Bounded to a small number of
// calls per scene so a scene with many unreported rolls can't chain into an
// unbounded number of AI calls.

import { callChatCompletion } from './chatCompletion'
import { AI_MODELS } from './models'
import { recordAICost, estimateTokenCount } from './cost-tracker'
import type { AdherenceResult, OutcomeBand } from '@/lib/game/outcomeAdherence'

const MAX_ANSWER_TOKENS = 10
const MAX_REPAIR_ATTEMPTS_PER_SCENE = 3

export interface OutcomeEchoRepairContext {
  sceneText: string
  characterName: string
  rolledOutcome: OutcomeBand
}

/**
 * Pure: builds the system+user prompt. No DB, no network — safe to unit
 * test directly, unlike the orchestration below.
 */
export function buildOutcomeEchoRepairPrompt(ctx: OutcomeEchoRepairContext): { system: string; user: string } {
  const system = `You wrote a scene and were supposed to report which outcome band your own prose depicted for a rolled action, but didn't. Read what you wrote and answer honestly - report what you actually WROTE, not what the roll said. Reply with EXACTLY ONE WORD: strongHit, weakHit, or miss. Nothing else - no punctuation, no explanation.`

  const user = `Your narration:\n${ctx.sceneText}\n\nWhich band did your narration above actually depict for ${ctx.characterName}'s rolled action? (The engine rolled ${ctx.rolledOutcome}, but answer based on what your prose shows, not that.)`

  return { system, user }
}

/**
 * Tolerant parse of a short free-text answer into a real OutcomeBand —
 * strips case/punctuation/spacing variance ("Strong Hit.", "MISS!",
 * "weak-hit") rather than requiring an exact literal match, since this is
 * a single word from a small model with no JSON mode to enforce shape.
 * Anything that doesn't clearly resolve to one of the three bands is null.
 */
export function parseOutcomeBandAnswer(raw: string): OutcomeBand | null {
  const normalized = raw.trim().toLowerCase().replace(/[^a-z]/g, '')
  const map: Record<string, OutcomeBand> = {
    stronghit: 'strongHit',
    weakhit: 'weakHit',
    miss: 'miss',
  }
  return map[normalized] ?? null
}

/**
 * Asks the model to self-report the outcome band it depicted for one
 * previously-unreported rolled action. Returns null on any failure (no API
 * key, API error, or a malformed/non-band answer) — the caller leaves that
 * entry as 'unreported', exactly as before this existed.
 */
export async function generateOutcomeEchoRepair(
  campaignId: string,
  ctx: OutcomeEchoRepairContext
): Promise<OutcomeBand | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const { system, user } = buildOutcomeEchoRepairPrompt(ctx)
  const startTime = Date.now()

  try {
    const result = await callChatCompletion({
      apiKey,
      model: AI_MODELS.EFFICIENT,
      systemPrompt: system,
      userPrompt: user,
      temperature: 0.3,
      maxTokens: MAX_ANSWER_TOKENS,
    })

    if (!result.ok) {
      console.error('Outcome echo repair API error:', result.status)
      return null
    }

    const answer = parseOutcomeBandAnswer(String(result.content || ''))
    if (!answer) return null

    await recordAICost({
      campaignId,
      model: AI_MODELS.EFFICIENT,
      requestType: 'outcome_echo_repair',
      inputTokens: result.usage.prompt_tokens || estimateTokenCount(system + user),
      outputTokens: result.usage.completion_tokens || estimateTokenCount(answer),
      responseTimeMs: Date.now() - startTime,
      success: true,
    }).catch(console.error)

    return answer
  } catch (err) {
    console.error('Outcome echo repair failed (entry stays unreported):', err)
    return null
  }
}

/**
 * Attempts to backfill every 'unreported' entry in an adherence result with
 * a real self-reported band, upgrading it to 'match'/'mismatch' on success.
 * Bounded to MAX_REPAIR_ATTEMPTS_PER_SCENE calls. Never touches 'match',
 * 'mismatch', or 'ambiguous' entries — only ever attempts to upgrade
 * 'unreported' ones. Returns the same object (by reference) when there's
 * nothing to repair, so a scene with no unreported rolls costs nothing
 * extra and does not re-render differently.
 */
export async function repairUnreportedAdherence(
  campaignId: string,
  sceneText: string,
  adherence: AdherenceResult
): Promise<AdherenceResult> {
  const toRepair = adherence.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.verdict === 'unreported')
    .slice(0, MAX_REPAIR_ATTEMPTS_PER_SCENE)

  if (toRepair.length === 0) return adherence

  const entries = [...adherence.entries]
  const problems = [...adherence.problems]
  let { matched, mismatched, unreported } = adherence

  for (const { entry, index } of toRepair) {
    const repaired = await generateOutcomeEchoRepair(campaignId, {
      sceneText,
      characterName: entry.characterName,
      rolledOutcome: entry.rolled,
    })
    if (!repaired) continue

    const verdict = repaired === entry.rolled ? 'match' : 'mismatch'
    entries[index] = { ...entry, narrated: repaired, verdict }
    unreported -= 1
    if (verdict === 'match') {
      matched += 1
    } else {
      mismatched += 1
      problems.push(`${entry.characterName}: the engine rolled ${entry.rolled}, but the narration read like ${repaired} (backfilled).`)
    }
  }

  return { entries, matched, mismatched, unreported, ambiguous: adherence.ambiguous, problems }
}
