// src/lib/ai/validation.ts
// Phase 15.2 & 15.3: AI Output Validation and Progressive Fallback

import { z } from 'zod'
import {
  AIGMResponseSchema,
  MinimalAIResponseSchema,
  TimePassageSchema,
  WorldTurnResponseSchema,
  WorldTurnNarrativeOnlySchema,
  WorldUpdatesSchema,
  type AIGMResponseValidated,
  type WorldTurnResponseValidated,
  type WorldUpdates,
  type TimePassage,
} from './schema'
import type { AIGMResponse } from './client'
import { prisma } from '@/lib/prisma'

/**
 * Validation Result Types
 */
// `world_updates` on the degraded levels was typed `{}` — which in
// TypeScript means "any non-null value", not "empty object", so it
// documented nothing and would have hidden a salvaged payload behind a
// type that says it carries none. Partial<WorldUpdates> is what these
// levels actually produce now.
export type ValidationResult =
  | { success: true; data: AIGMResponseValidated; level: 'full' }
  | { success: true; data: { scene_text: string; world_updates: Partial<WorldUpdates>; time_passage?: TimePassage }; level: 'partial' }
  | { success: true; data: { scene_text: string; world_updates: Partial<WorldUpdates>; time_passage?: TimePassage }; level: 'emergency'; template: string }
  | { success: false; error: string; rawData?: any }

/**
 * Emergency fallback templates for when AI completely fails
 */
const EMERGENCY_TEMPLATES = {
  default: `The scene unfolds in unexpected ways. The situation remains tense and uncertain as events develop.

(AI GM temporarily unavailable - scene will be resolved manually or retried)`,

  combat: `The battle continues with intensity. Both sides exchange blows, but the outcome remains unclear.

(AI GM temporarily unavailable - combat will be resolved when service recovers)`,

  social: `The conversation takes an interesting turn. The NPCs react to the characters' words and actions, though their true intentions remain hidden.

(AI GM temporarily unavailable - social encounter will be resolved when service recovers)`,

  exploration: `The characters continue their exploration, discovering intriguing details about their surroundings. What they find raises more questions than answers.

(AI GM temporarily unavailable - exploration will continue when service recovers)`
}

/**
 * Build the repair prompt for a failed Level-1 validation: names the
 * specific structural problems (capped at 8, matching the console-log
 * summary elsewhere in this file) so the re-prompt is a targeted fix
 * rather than "try again" — a model that produced valid prose but wrong
 * JSON shape usually just needs to be told exactly what shape was wrong.
 */
export function buildRepairPrompt(zodError: z.ZodError): string {
  const issues = zodError.errors
    .slice(0, 8)
    .map(e => `- ${e.path.join('.') || '(root)'}: ${e.message}`)
    .join('\n')
  return `Your previous response was not valid JSON matching the required schema. Specific problems:\n${issues}\n\nReturn a corrected JSON response preserving the same scene content and world updates you intended — fix only the structural issues above. Respond with JSON only, matching the original response_format (scene_text, time_passage, world_updates).`
}

/**
 * Depth-hardening #36 (see README): a single bounded repair round-trip
 * before falling all the way through to progressive degradation. Below
 * Level 1, validateAIResponse silently zeroes world_updates — real
 * mechanical consequences vanish with only a console warning as evidence.
 * This re-prompts the model with the exact Zod errors and re-validates its
 * corrected response, giving a fixable shape mistake one real chance to
 * actually get fixed instead of immediately discarding all mechanical
 * content for the scene.
 *
 * Bounded to exactly one attempt — a persistently malformed model falls
 * through to the existing ladder (validateAIResponse) exactly as before
 * this existed, so a bad repair can never hang scene resolution or loop.
 * `repair` is injected so this is testable without a network call; the
 * caller (client.ts) supplies the actual re-prompt-and-parse logic.
 */
export async function validateAIResponseWithRepair(
  rawResponse: any,
  sceneContext: string | undefined,
  repair: (repairPrompt: string) => Promise<any>
): Promise<ValidationResult> {
  const firstAttempt = AIGMResponseSchema.safeParse(rawResponse)
  if (firstAttempt.success) {
    console.log('✅ Full schema validation passed')
    return { success: true, data: firstAttempt.data, level: 'full' }
  }

  console.warn('⚠️ Full schema validation failed:', firstAttempt.error.errors)
  console.log('Attempting one repair round-trip...')

  try {
    const repairedRaw = await repair(buildRepairPrompt(firstAttempt.error))
    const repairedAttempt = AIGMResponseSchema.safeParse(repairedRaw)
    if (repairedAttempt.success) {
      console.log('✅ Repair round-trip succeeded — full schema validation now passes')
      return { success: true, data: repairedAttempt.data, level: 'full' }
    }
    console.warn('⚠️ Repair round-trip still failed validation:', repairedAttempt.error.errors)
  } catch (error) {
    console.error('❌ Repair round-trip errored:', error)
  }

  console.log('Falling back to progressive degradation...')
  return validateAIResponse(rawResponse, sceneContext)
}

/**
 * Phase 15.2: Validate AI output with strict schema
 * Phase 15.3: Progressive fallback on validation failure
 */
export function validateAIResponse(rawResponse: any, sceneContext?: string): ValidationResult {
  console.log('🔍 Validating AI response...')

  // Level 1: Try full schema validation
  try {
    const validated = AIGMResponseSchema.parse(rawResponse)
    console.log('✅ Full schema validation passed')
    return {
      success: true,
      data: validated,
      level: 'full'
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.warn('⚠️ Full schema validation failed:', error.errors)
      console.log('Attempting partial extraction...')
    } else {
      console.error('❌ Unexpected validation error:', error)
    }
  }

  // Level 2: Try to extract at least scene_text
  try {
    const minimalValidated = MinimalAIResponseSchema.parse(rawResponse)
    console.log('✅ Partial validation passed - extracted scene_text')

    return {
      success: true,
      data: {
        scene_text: minimalValidated.scene_text,
        // Salvage whatever passes its own schema instead of zeroing the
        // lot. Everything kept has passed exactly the validation it would
        // have passed at Level 1, so no applier sees unvalidated input —
        // but a scene no longer loses every mechanical consequence over
        // one bad field somewhere else in the response.
        world_updates: extractValidWorldUpdates((rawResponse as any)?.world_updates),
        // Same salvage discipline for time_passage: a response can fail
        // full validation over something unrelated (a malformed NPC entry,
        // say) while still having reported perfectly good time_passage —
        // that shouldn't cost the world-turn clock a bank it actually
        // earned. See extractValidTimePassage.
        time_passage: extractValidTimePassage((rawResponse as any)?.time_passage)
      },
      level: 'partial'
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.warn('⚠️ Partial validation failed:', error.errors)
    }
  }

  // Level 3: Try to extract scene_text from various possible structures
  const extractedText = extractSceneTextLoosely(rawResponse)
  if (extractedText && extractedText.length >= 10) {
    console.log('✅ Loose extraction successful')
    return {
      success: true,
      data: {
        scene_text: extractedText,
        world_updates: extractValidWorldUpdates((rawResponse as any)?.world_updates),
        time_passage: extractValidTimePassage((rawResponse as any)?.time_passage)
      },
      level: 'partial'
    }
  }

  // Level 4: Emergency fallback - use template
  console.error('❌ All extraction attempts failed - using emergency template')
  const template = selectEmergencyTemplate(sceneContext)

  return {
    success: true,
    data: {
      scene_text: template,
      world_updates: {},
      // Still worth salvaging even here: the response was unusable as
      // prose, but if it happened to carry a valid time_passage, the
      // world-turn clock shouldn't stall just because the narration did.
      time_passage: extractValidTimePassage((rawResponse as any)?.time_passage)
    },
    level: 'emergency',
    template: 'default'
  }
}

/**
 * Salvage a valid time_passage independently of the rest of the response.
 * Mirrors extractValidWorldUpdates's reasoning: a response can fail full
 * schema validation over a field that has nothing to do with time_passage
 * (a malformed NPC entry, an out-of-range harm value) while still having
 * reported a perfectly good time_passage — the degradation ladder
 * shouldn't cost the world-turn clock a bank it actually earned just
 * because something else in the same response was wrong.
 */
export function extractValidTimePassage(rawTimePassage: unknown): TimePassage | undefined {
  const parsed = TimePassageSchema.safeParse(rawTimePassage)
  return parsed.success ? parsed.data : undefined
}

/**
 * Try to extract scene_text from malformed response
 * Handles common AI response issues like:
 * - Incorrect nesting
 * - Different field names
 * - Plain text responses
 */
function extractSceneTextLoosely(rawResponse: any): string | null {
  // Try direct field access
  if (typeof rawResponse === 'string') {
    return rawResponse
  }

  if (typeof rawResponse !== 'object' || rawResponse === null) {
    return null
  }

  // Try common field names
  const possibleFields = [
    'scene_text',
    'sceneText',
    'scene',
    'narrative',
    'description',
    'text',
    'content',
    'resolution'
  ]

  for (const field of possibleFields) {
    if (typeof rawResponse[field] === 'string') {
      return rawResponse[field]
    }
  }

  // Try nested structures
  if (rawResponse.response?.scene_text) {
    return rawResponse.response.scene_text
  }

  if (rawResponse.data?.scene_text) {
    return rawResponse.data.scene_text
  }

  // If it's a JSON with a single string value, use that
  const values = Object.values(rawResponse)
  const stringValues = values.filter(v => typeof v === 'string' && v.length > 50)
  if (stringValues.length === 1) {
    return stringValues[0] as string
  }

  return null
}

/**
 * Select appropriate emergency template based on scene context
 */
function selectEmergencyTemplate(sceneContext?: string): string {
  if (!sceneContext) {
    return EMERGENCY_TEMPLATES.default
  }

  const lowerContext = sceneContext.toLowerCase()

  if (lowerContext.includes('combat') || lowerContext.includes('battle') || lowerContext.includes('fight')) {
    return EMERGENCY_TEMPLATES.combat
  }

  if (lowerContext.includes('talk') || lowerContext.includes('negotiate') || lowerContext.includes('persuade')) {
    return EMERGENCY_TEMPLATES.social
  }

  if (lowerContext.includes('explore') || lowerContext.includes('search') || lowerContext.includes('investigate')) {
    return EMERGENCY_TEMPLATES.exploration
  }

  return EMERGENCY_TEMPLATES.default
}

/**
 * Salvage whatever survives full validation, section by section and
 * element by element.
 *
 * Below Level 1 the ladder used to zero `world_updates` outright: one bad
 * field anywhere in the response and every mechanical consequence of the
 * scene vanished — harm dealt, clocks advanced, relationships moved — with
 * a console warning as the only evidence. That is what this exists to
 * stop, and it had no callers, so it never stopped it.
 *
 * The version that sat here did not validate anything. It kept a section
 * if it was a non-empty array, whatever was in it. Wiring THAT in would
 * have handed unvalidated objects straight to the state appliers and
 * bypassed every bound the schemas exist to enforce — unbounded harm
 * numbers, unbounded appended prose (#46/#81), ungated corruption. So the
 * salvage is done through the real schemas instead:
 *
 *  - Each section is validated on its own. A malformed `npc_changes` can
 *    no longer cost you `pc_changes`.
 *  - If a section fails as a whole, its ELEMENTS are validated one at a
 *    time and the good ones kept. One malformed NPC entry out of five
 *    should cost that entry, not the other four.
 *  - Anything kept has passed exactly the same schema it would have passed
 *    at Level 1. Nothing reaches an applier unvalidated, which is the
 *    property that makes salvaging safe to do at all.
 */
export function extractValidWorldUpdates(rawUpdates: unknown): Partial<WorldUpdates> {
  if (!rawUpdates || typeof rawUpdates !== 'object' || Array.isArray(rawUpdates)) {
    return {}
  }

  const raw = rawUpdates as Record<string, unknown>
  const salvaged: Record<string, unknown> = {}

  for (const section of Object.keys(WorldUpdatesSchema.shape)) {
    const value = raw[section]
    if (value === undefined || value === null) continue

    // Pick the one field so each section is judged against its own real
    // schema, using only Zod's public API rather than reaching into the
    // internals of an optional-wrapped array type.
    const sectionSchema = WorldUpdatesSchema.pick({ [section]: true } as never)

    const whole = sectionSchema.safeParse({ [section]: value })
    if (whole.success) {
      const parsed = (whole.data as Record<string, unknown>)[section]
      if (parsed !== undefined) salvaged[section] = parsed
      continue
    }

    // Section-level failure. If it's a list, keep the entries that stand
    // on their own.
    if (!Array.isArray(value)) {
      console.warn(`⚠️ Dropping unsalvageable ${section} from a partially-valid response`)
      continue
    }

    const keptEntries = value.filter(
      entry => sectionSchema.safeParse({ [section]: [entry] }).success
    )
    if (keptEntries.length > 0) {
      salvaged[section] = keptEntries
      console.warn(
        `⚠️ Salvaged ${keptEntries.length}/${value.length} ${section} entries from a partially-valid response`
      )
    } else {
      console.warn(`⚠️ Dropping all ${value.length} ${section} entries — none passed validation`)
    }
  }

  return salvaged as Partial<WorldUpdates>
}

/**
 * Log validation failures for debugging and improvement
 */
export async function logValidationFailure(
  campaignId: string,
  sceneId: string,
  rawResponse: any,
  validationError: z.ZodError
): Promise<void> {
  try {
    const summary = validationError.errors
      .slice(0, 3)
      .map(e => `${e.path.join('.')}: ${e.message}`)
      .join('; ')

    console.error('Validation failure details:', {
      campaignId,
      sceneId,
      summary,
      rawResponseKeys: Object.keys(rawResponse || {}),
      timestamp: new Date().toISOString()
    })

    await prisma.aIValidationFailure.create({
      data: {
        campaignId,
        sceneId: sceneId || null,
        errorSummary: summary,
        rawResponse: rawResponse ?? undefined,
        zodErrors: validationError.errors as any
      }
    })
  } catch (error) {
    console.error('Failed to log validation failure:', error)
  }
}

/**
 * Validate the background world-turn response (callAIForWorldTurn).
 *
 * That call writes through the same applyWorldUpdates path scene
 * resolution does, but used to return a bare JSON.parse with no schema —
 * so a malformed npc_changes/faction_changes entry reached the DB writer
 * with none of the bounds the main response contract enforces. Its
 * TypeScript return type was purely a compile-time fiction.
 *
 * Two tiers, mirroring the philosophy of the main ladder (degrade, never
 * crash — this call is a background nicety and must never take down a
 * world turn):
 *   full      — everything parsed; events, notes, updates, ambitions all used.
 *   narrative — the whole parse failed, but events/notes alone are valid.
 *               Kept (they mutate nothing); world_updates and
 *               ambition_picks are DROPPED rather than passed through
 *               unvalidated. A malformed faction change must not reach the
 *               writer just because the prose around it happened to parse.
 *   none      — neither parsed; caller falls back to its empty result.
 *
 * Pure and synchronous: failure logging is the caller's business (it has
 * the campaignId), matching how logValidationFailure is already used.
 */
export type WorldTurnValidationResult =
  | { level: 'full'; data: WorldTurnResponseValidated }
  | { level: 'narrative'; data: WorldTurnResponseValidated; error: z.ZodError }
  | { level: 'none'; error: z.ZodError }

export function validateWorldTurnResponse(raw: unknown): WorldTurnValidationResult {
  const full = WorldTurnResponseSchema.safeParse(raw)
  if (full.success) {
    return { level: 'full', data: full.data }
  }

  const narrative = WorldTurnNarrativeOnlySchema.safeParse(raw)
  if (narrative.success) {
    console.warn(
      `⚠️ World-turn response failed full validation (${full.error.errors.length} issue(s)); ` +
      `keeping ${narrative.data.offscreen_events.length} narrative event(s), dropping world_updates/ambition_picks.`
    )
    return {
      level: 'narrative',
      // Explicitly reconstructed rather than spread from raw — this is the
      // line that guarantees no unvalidated state-mutating field survives.
      data: {
        offscreen_events: narrative.data.offscreen_events,
        gm_notes: narrative.data.gm_notes,
      },
      error: full.error,
    }
  }

  return { level: 'none', error: full.error }
}

/**
 * Enhance AI response with validation metadata
 */
export function addValidationMetadata(
  response: AIGMResponse,
  validationLevel: 'full' | 'partial' | 'emergency'
): AIGMResponse & { _validationLevel: string; _usedFallback: boolean } {
  return {
    ...response,
    _validationLevel: validationLevel,
    _usedFallback: validationLevel !== 'full'
  }
}
