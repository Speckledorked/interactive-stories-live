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
//
// Originally scoped to ONLY one character's fog-of-war knowledge + the
// current scene text — no campaign lore at all. That meant a genuine,
// established fact about how the setting itself works (e.g. "every being
// in this universe has an intuitive guidance system," if the campaign's
// own imported lore says so) was invisible to this call, so the model
// could only ever answer "your character hasn't learned that yet" —
// correct for an in-fiction discovery, wrong for a question about how a
// setting-wide system actually works. Now also retrieves the campaign's
// own lore relevant to the question, and the prompt is told to treat a
// question about how a system/mechanic WORKS as different from a question
// about what the character currently perceives — the former can be
// answered from canon directly; only the latter stays gated by what this
// specific character has personally experienced.

import { callChatCompletion } from './chatCompletion'
import { AI_MODELS } from './models'
import { recordAICost, estimateTokenCount } from './cost-tracker'
import { buildWorldSummaryForAI } from './worldState'
import { retrieveRelevantLore, type RetrievedLoreEntry } from './loreRetrieval'

export const MAX_QUESTION_CHARS = 500
const MAX_ANSWER_TOKENS = 300

export interface AskGmPromptContext {
  campaignTitle: string
  universe: string
  characterName: string
  characterSummary: unknown // the fog-of-war-safe entry from worldSummary.characters, or null
  sceneText: string // current scene intro + resolution-so-far
  question: string
  relevantLore: Pick<RetrievedLoreEntry, 'title' | 'content'>[]
}

/**
 * Pure: builds the system+user prompt. No DB, no network — safe to unit
 * test directly, unlike the orchestration below.
 */
export function buildAskGmPrompt(ctx: AskGmPromptContext): { system: string; user: string } {
  const system = `You are the game master's out-of-character voice, answering a player's clarifying question about the fiction — a quick aside at the table, not a turn.

Rules:
- Nothing you say here happens in the story. No dice, no consequences, no NPC reactions, no time passing, no new events.
- Two different kinds of question need different answers. (1) "How does [a system/mechanic/rule of this setting] actually work?" is a question about the SETTING ITSELF — answer it from the campaign lore below if it's covered there, as established fact, even if ${ctx.characterName} hasn't personally experienced it yet in play. (2) "What do I see/know/notice right now?" is a question about THIS CHARACTER's current in-fiction perception — answer only with what ${ctx.characterName} could actually perceive or know right now, given the scene and their own knowledge below.
- If the honest answer is "you don't know" or "you'd have to act to find out," say that plainly — never invent information just to be helpful. This applies to type (2) questions; a type (1) question about how the setting works should be answered directly from lore when the lore covers it, not deflected as something the character has to discover first.
- Be brief and concrete: 1-3 sentences. This is a fast clarification, not narration.
- Never break the fourth wall about game mechanics (dice, stats, rules) unless the player's question is itself about mechanics.`

  const loreBlock = ctx.relevantLore.length > 0
    ? `\n\nCAMPAIGN LORE (canon — treat as established fact if it answers the question):\n${ctx.relevantLore.map(l => `- ${l.title}: ${l.content}`).join('\n')}`
    : ''

  const user = `CAMPAIGN: ${ctx.campaignTitle} (${ctx.universe})

CURRENT SCENE:
${ctx.sceneText || '(no scene text yet)'}

${ctx.characterName.toUpperCase()}'S KNOWLEDGE:
${JSON.stringify(ctx.characterSummary, null, 2)}${loreBlock}

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
export async function generateGmAnswer(campaignId: string, opts: AskGmOptions): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const { worldSummary } = await buildWorldSummaryForAI(campaignId)
  const characterSummary = (worldSummary.characters as any[]).find(c => c.id === opts.characterId) || null
  const question = opts.question.slice(0, MAX_QUESTION_CHARS)

  // retrieveRelevantLore already fails open to [] on any embedding/DB
  // error — a lore lookup failing degrades this back to the old
  // fog-of-war-only behavior, never blocks the answer entirely.
  const relevantLore = await retrieveRelevantLore(campaignId, question)

  const { system, user } = buildAskGmPrompt({
    campaignTitle: opts.campaignTitle,
    universe: opts.universe,
    characterName: opts.characterName,
    characterSummary,
    sceneText: opts.sceneText,
    question,
    relevantLore,
  })

  const startTime = Date.now()
  try {
    const result = await callChatCompletion({
      apiKey,
      model: AI_MODELS.EFFICIENT,
      systemPrompt: system,
      userPrompt: user,
      temperature: 0.6,
      maxTokens: MAX_ANSWER_TOKENS,
    })

    if (!result.ok) {
      console.error('Ask-GM API error:', result.status)
      return null
    }

    const answer = String(result.content || '').trim()
    if (!answer) return null

    await recordAICost({
      campaignId,
      model: AI_MODELS.EFFICIENT,
      requestType: 'gm_clarification',
      inputTokens: result.usage.prompt_tokens || estimateTokenCount(system + user),
      outputTokens: result.usage.completion_tokens || estimateTokenCount(answer),
      responseTimeMs: Date.now() - startTime,
      success: true,
    }).catch(console.error)

    return answer
  } catch (err) {
    console.error('Ask-GM failed:', err)
    return null
  }
}
