// src/lib/ai/sceneStakes.ts
// Populates Scene.stakes — a one-sentence "what's at risk in this scene"
// statement, generated once when a scene opens from its own intro text.
// The field already existed in the schema and was already read by
// memoryRetrieval.ts's query-context builder, but nothing ever wrote it.
//
// Same fail-open shape as chronicleNarration.ts/calendarGenerator.ts: no
// API key or any error/malformed response just returns null, and the
// caller (sceneResolver.ts's createNewScene) creates the scene with
// stakes: null rather than blocking scene creation on this call.

import { prisma } from '@/lib/prisma'
import { callChatCompletion } from './chatCompletion'
import { AI_MODELS } from './models'
import { recordAICost, estimateTokenCount } from './cost-tracker'

const MIN_CHARS = 10
const MAX_CHARS = 280

/**
 * Pure — validates the raw AI JSON response, returns null on anything
 * malformed or degenerate (empty, absurdly short/long, or still
 * JSON-shaped rather than a plain sentence).
 */
export function validateGeneratedStakes(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const stakes = (raw as Record<string, unknown>).stakes
  if (typeof stakes !== 'string') return null

  const trimmed = stakes.trim()
  if (trimmed.length < MIN_CHARS || trimmed.length > MAX_CHARS) return null
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return null

  return trimmed
}

/**
 * Generates a one-sentence "what's at stake" statement for a freshly
 * opened scene, or null on any failure (no API key, API error, malformed
 * response, or the scene's own intro text being too short to ground a
 * real answer in).
 */
export async function generateSceneStakes(
  campaignId: string,
  sceneIntroText: string
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  if (!sceneIntroText || sceneIntroText.trim().length < 40) return null

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { title: true, universe: true },
  })
  if (!campaign) return null

  const system =
    'You identify the concrete stakes of a tabletop RPG scene from its opening text — what is genuinely at risk if the player characters fail or fumble this. ' +
    'One sentence, specific to this scene (not a generic "danger looms"), grounded only in what the scene text actually establishes. ' +
    'JSON only: {"stakes": "..."}'

  const user =
    `Universe: ${campaign.universe || 'Generic Fantasy'}\nCampaign: "${campaign.title}"\n\n` +
    `Scene opening:\n${sceneIntroText}\n\n` +
    'What is at stake in this scene? One sentence, concrete, no hedging ("might", "could" — state it as the real risk this scene poses).'

  const startTime = Date.now()

  try {
    const result = await callChatCompletion({
      apiKey,
      model: AI_MODELS.EFFICIENT,
      systemPrompt: system,
      userPrompt: user,
      temperature: 0.7,
      maxTokens: 200,
      jsonMode: true,
    })

    if (!result.ok) {
      console.error('Scene stakes generation API error:', result.status)
      return null
    }

    let raw: unknown
    try {
      raw = JSON.parse(result.content)
    } catch {
      return null
    }

    const stakes = validateGeneratedStakes(raw)
    if (!stakes) return null

    await recordAICost({
      campaignId,
      model: AI_MODELS.EFFICIENT,
      requestType: 'scene_stakes',
      inputTokens: result.usage.prompt_tokens || estimateTokenCount(system + user),
      outputTokens: result.usage.completion_tokens || estimateTokenCount(stakes),
      responseTimeMs: Date.now() - startTime,
      success: true,
    }).catch(console.error)

    return stakes
  } catch (err) {
    console.error('Scene stakes generation failed (scene proceeds with no stakes statement):', err)
    return null
  }
}
