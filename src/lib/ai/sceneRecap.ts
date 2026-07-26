// src/lib/ai/sceneRecap.ts
// Small, standalone recap generators — moved out of worldState.ts. Neither
// builds a world summary; both are cheap, dedicated calls over already-
// written text (a scene's resolution, or a run of per-scene summaries).

import { AI_MODELS } from './models'
import { recordAICost, estimateTokenCount } from './cost-tracker'
import { callChatCompletion } from '@/lib/ai/chatCompletion'

/**
 * Retroactively summarize a scene's resolution text for the Story Log.
 *
 * Historical scenes never persisted the AI GM's scene_summary/
 * new_timeline_events (those only existed transiently in the resolution
 * response) - sceneResolutionText is the only surviving record. This is a
 * cheap, dedicated call over that text alone, used by the Story Log
 * "Regenerate" maintenance action. No internal fallback on purpose: this
 * module can't import sceneResolver's fallbackSummaryFromSceneText without
 * risking a circular import, so callers are expected to catch and skip.
 */
export async function summarizeSceneForLog(campaignId: string, sceneText: string): Promise<{ summary: string; highlights: string[] }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  const startTime = Date.now()
  const prompt = `Summarize the following scene from a tabletop RPG campaign for a player-facing "Story Log" entry.

SCENE TEXT:
${sceneText}

Respond with JSON only, in this exact shape:
{
  "summary": "2-3 sentence summary of what happened in this scene, written as narrative prose (not bullet points, not truncated).",
  "highlights": ["short phrase for a key moment", "short phrase for another key moment"]
}

The summary must be complete sentences that stand alone without the original text. highlights should be 0-5 short phrases (not full sentences) naming the most notable beats - omit it entirely (empty array) if nothing stands out.`

  const result = await callChatCompletion({
    apiKey,
    model: AI_MODELS.EFFICIENT,
    systemPrompt: 'You summarize RPG scene text into concise, player-facing recap entries. You always respond with valid JSON.',
    userPrompt: prompt,
    temperature: 0.5,
    maxTokens: 300,
    jsonMode: true,
  })

  if (!result.ok) {
    throw new Error(`OpenAI API error: ${result.status}`)
  }

  const content = result.content

  await recordAICost({
    campaignId,
    model: AI_MODELS.EFFICIENT,
    requestType: 'story_log_summary',
    inputTokens: result.usage.prompt_tokens || estimateTokenCount(prompt),
    outputTokens: result.usage.completion_tokens || estimateTokenCount(content),
    responseTimeMs: Date.now() - startTime,
    success: true
  }).catch(console.error)

  const parsed = JSON.parse(content)
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
  if (!summary) {
    throw new Error('Summary generation returned an empty summary')
  }

  const highlights = Array.isArray(parsed.highlights)
    ? parsed.highlights.filter((h: unknown): h is string => typeof h === 'string' && h.trim().length > 0).map((h: string) => h.trim())
    : []

  return { summary, highlights }
}

/**
 * Write a short retrospective covering the last CAMPAIGN_MILESTONE_INTERVAL
 * scenes, for the milestone Story Log entry created by
 * lib/game/campaignMilestone.ts. Takes the already-written per-scene
 * summaries rather than raw scene text — cheap, and those summaries are
 * themselves already genuine recaps (see summarizeSceneForLog /
 * scene_summary), so this is a summary-of-summaries, not a re-read of
 * everything that happened.
 */
export async function generateMilestoneRecap(campaignId: string, sceneSummaries: string[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  const startTime = Date.now()
  const prompt = `Here are the per-scene summaries from the most recent stretch of a tabletop RPG campaign, in order:

${sceneSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Write a short retrospective (3-5 sentences) of this stretch of the campaign for a player-facing "Campaign Milestone" entry — the throughline of what the party has been through, not a scene-by-scene recap. Plain prose, past tense, third person, no dialogue quotes.

Respond with JSON only: { "recap": "..." }`

  const result = await callChatCompletion({
    apiKey,
    model: AI_MODELS.EFFICIENT,
    systemPrompt: 'You write short, evocative campaign retrospectives for a tabletop RPG Story Log. You always respond with valid JSON.',
    userPrompt: prompt,
    temperature: 0.6,
    maxTokens: 300,
    jsonMode: true,
  })

  if (!result.ok) {
    throw new Error(`OpenAI API error: ${result.status}`)
  }

  const content = result.content

  await recordAICost({
    campaignId,
    model: AI_MODELS.EFFICIENT,
    requestType: 'campaign_milestone_recap',
    inputTokens: result.usage.prompt_tokens || estimateTokenCount(prompt),
    outputTokens: result.usage.completion_tokens || estimateTokenCount(content),
    responseTimeMs: Date.now() - startTime,
    success: true
  }).catch(console.error)

  const parsed = JSON.parse(content)
  const recap = typeof parsed.recap === 'string' ? parsed.recap.trim() : ''
  if (!recap) {
    throw new Error('Milestone recap generation returned an empty recap')
  }

  return recap
}
