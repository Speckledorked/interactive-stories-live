// src/lib/ai/askGm.ts
// "Ask the GM" — out-of-character clarifying questions, deliberately NOT
// action resolution. See the GmClarification model's schema doc for why
// this must never touch PlayerAction/ExchangeManager/world_updates: a
// player clarifying the fiction ("what can I see on this person?") before
// deciding their real action shouldn't cost dice, consequences, or a turn.
//
// Reuses buildWorldSummaryForAI's fog-of-war-safe context — the same
// knowledge boundary the AI narrator itself is held to — but calls the
// model directly with a small, single-purpose prompt, mirroring
// generateNewSceneIntro's pattern (a plain free-text completion) rather
// than callAIGM's (a JSON-schema world_updates response).

import { openaiFetch } from './openaiCompat'
import { AI_MODELS } from './models'
import { recordAICost, estimateTokenCount } from './cost-tracker'
import { buildWorldSummaryForAI } from './worldState'

export const MAX_QUESTION_CHARS = 500
const MAX_ANSWER_TOKENS = 300

export interface AskGmPromptContext {
  campaignTitle: string
  universe: string
  characterName: string
  characterSummary: unknown // the fog-of-war-safe entry from worldSummary.characters, or null
  sceneText: string // current scene intro + resolution-so-far
  question: string
}

/**
 * Pure: builds the system+user prompt. No DB, no network — safe to unit
 * test directly, unlike the orchestration below.
 */
export function buildAskGmPrompt(ctx: AskGmPromptContext): { system: string; user: string } {
  const system = `You are the game master's out-of-character voice, answering a player's clarifying question about the fiction — a quick aside at the table, not a turn.

Rules:
- Nothing you say here happens in the story. No dice, no consequences, no NPC reactions, no time passing, no new events.
- Answer only with what ${ctx.characterName} could actually perceive or know right now, given the scene and their own knowledge below.
- If the honest answer is "you don't know" or "you'd have to act to find out," say that plainly — never invent information just to be helpful.
- Be brief and concrete: 1-3 sentences. This is a fast clarification, not narration.
- Never break the fourth wall about game mechanics (dice, stats, rules) unless the player's question is itself about mechanics.`

  const user = `CAMPAIGN: ${ctx.campaignTitle} (${ctx.universe})

CURRENT SCENE:
${ctx.sceneText || '(no scene text yet)'}

${ctx.characterName.toUpperCase()}'S KNOWLEDGE:
${JSON.stringify(ctx.characterSummary, null, 2)}

${ctx.characterName}'s question: "${ctx.question}"

Answer directly, as the GM speaking to the player out of character.`

  return { system, user }
}

export interface AskGmOptions {
  campaignTitle: string
  universe: string
  characterId: string
  characterName: string
  sceneText: string
  question: string
}

/**
 * Answer a player's out-of-character question, grounded in the same
 * fog-of-war-safe knowledge the AI narrator has. Returns null on any
 * failure (no API key, network error, malformed response) — the caller
 * treats that as "try again," never as a fabricated answer.
 */
export async function answerGmQuestion(campaignId: string, opts: AskGmOptions): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const { worldSummary } = await buildWorldSummaryForAI(campaignId)
  const characterSummary = (worldSummary.characters as any[]).find(c => c.id === opts.characterId) || null

  const { system, user } = buildAskGmPrompt({
    campaignTitle: opts.campaignTitle,
    universe: opts.universe,
    characterName: opts.characterName,
    characterSummary,
    sceneText: opts.sceneText,
    question: opts.question.slice(0, MAX_QUESTION_CHARS),
  })

  const startTime = Date.now()
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
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.6,
        max_tokens: MAX_ANSWER_TOKENS,
      }),
    })

    if (!response.ok) {
      console.error('Ask-GM API error:', response.status)
      return null
    }

    const data = await response.json()
    const answer = String(data.choices?.[0]?.message?.content || '').trim()
    if (!answer) return null

    const usage = data.usage || {}
    await recordAICost({
      campaignId,
      model: AI_MODELS.EFFICIENT,
      requestType: 'gm_clarification',
      inputTokens: usage.prompt_tokens || estimateTokenCount(system + user),
      outputTokens: usage.completion_tokens || estimateTokenCount(answer),
      responseTimeMs: Date.now() - startTime,
      success: true,
    }).catch(console.error)

    return answer
  } catch (err) {
    console.error('Ask-GM failed:', err)
    return null
  }
}
