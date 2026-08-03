// src/lib/ai/imageGeneration.ts
// #96: scene illustration — one generated image per resolved scene.
//
// Two responsibilities, deliberately kept separate:
//  1. buildScenePrompt — pure, deterministic. The scene's own resolved
//     narration IS the illustration brief; no separate AI call is spent
//     just to build a prompt (unlike, say, a dedicated prompt-refinement
//     step — add one later only if quality actually demands it).
//  2. generateSceneImage — the real API call + cost tracking. Fails
//     CLOSED (throws) on any error: the caller (imageGenQueue.ts) owns
//     retry/failure bookkeeping the same way processResolutionJob does
//     for the main narrative call, so this function's only job is "make
//     the real request or say why it couldn't."
//
// NEEDS VERIFICATION AGAINST A REAL OPENAI_API_KEY before enabling
// sceneImageGenerationEnabled in production — this sandbox has none. In
// particular: gpt-image-1 always returns base64 image data (no `url`
// response_format like dall-e-2/3 supported) as of this file's writing;
// re-confirm against the live API docs if that has changed.

import OpenAI from 'openai'
import { AI_MODELS } from './models'
import { recordAICost } from './cost-tracker'
import { truncateWithEllipsis } from '@/lib/format'

// Lazily constructed so importing this module doesn't crash in
// environments without OPENAI_API_KEY set — matches every other AI
// integration in this codebase (embeddingService.ts, worldGenerator.ts,
// etc).
let openai: OpenAI | null = null
function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return openai
}

// Bounded well below OpenAI's own prompt length ceiling — an illustration
// brief doesn't need or want a full scene dump, just the vivid parts.
const PROMPT_MAX_CHARS = 900
const IMAGE_STYLE_SUFFIX = 'Digital painting, atmospheric, cinematic lighting. No text or watermarks.'

export interface ScenePromptInput {
  sceneIntroText: string
  sceneResolutionText: string | null
  framing: string | null
  location: string | null
}

/**
 * Pure — no DB access, no AI call, safe to unit test directly. Prefers the
 * scene's resolved narration (what actually happened), falling back to its
 * framing text, then its intro text, for a scene that somehow has neither
 * (shouldn't happen for a resolved scene, but never produce an empty
 * prompt).
 */
export function buildScenePrompt(scene: ScenePromptInput): string {
  const narrative = (scene.sceneResolutionText || scene.framing || scene.sceneIntroText || '').trim()
  const locationNote = scene.location ? `Setting: ${scene.location}. ` : ''
  const body = truncateWithEllipsis(narrative, PROMPT_MAX_CHARS)
  return `${locationNote}${body} ${IMAGE_STYLE_SUFFIX}`.trim()
}

export interface GeneratedImage {
  imageBuffer: Buffer
  contentType: string
}

/**
 * Calls the image-generation endpoint and returns the raw image bytes.
 * Throws on failure — callers must catch and handle retries themselves,
 * same contract resolveScene's own AI call has.
 */
export async function generateSceneImage(campaignId: string, sceneId: string, prompt: string): Promise<GeneratedImage> {
  const startTime = Date.now()
  let success = false
  try {
    const response = await getOpenAI().images.generate({
      model: AI_MODELS.IMAGE,
      prompt,
      size: '1024x1024',
      n: 1,
    })

    const b64 = response.data?.[0]?.b64_json
    if (!b64) {
      throw new Error('Image generation returned no image data')
    }

    success = true
    return { imageBuffer: Buffer.from(b64, 'base64'), contentType: 'image/png' }
  } finally {
    // Fire-and-forget, same convention as embedWithCostTracking — a
    // cost-tracking failure must never mask (or be masked by) the real
    // generation result, success or failure.
    await recordAICost({
      campaignId,
      model: AI_MODELS.IMAGE,
      requestType: 'scene_image_generation',
      inputTokens: 0,
      outputTokens: 0,
      responseTimeMs: Date.now() - startTime,
      success,
      sceneId,
    }).catch(console.error)
  }
}
