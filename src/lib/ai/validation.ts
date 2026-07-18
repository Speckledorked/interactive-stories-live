// src/lib/ai/validation.ts
// Phase 15.2 & 15.3: AI Output Validation and Progressive Fallback

import { z } from 'zod'
import { AIGMResponseSchema, MinimalAIResponseSchema, type AIGMResponseValidated } from './schema'
import type { AIGMResponse } from './client'
import { prisma } from '@/lib/prisma'

/**
 * Validation Result Types
 */
export type ValidationResult =
  | { success: true; data: AIGMResponseValidated; level: 'full' }
  | { success: true; data: { scene_text: string; world_updates: {} }; level: 'partial' }
  | { success: true; data: { scene_text: string; world_updates: {} }; level: 'emergency'; template: string }
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
        world_updates: {} // Empty updates - no mechanical changes
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
        world_updates: {}
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
      world_updates: {}
    },
    level: 'emergency',
    template: 'default'
  }
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
 * Validate partial world updates
 * Used when we have scene_text but want to salvage any valid updates
 */
export function extractValidWorldUpdates(rawUpdates: any): any {
  if (!rawUpdates || typeof rawUpdates !== 'object') {
    return {}
  }

  const validated: any = {}

  // Try to validate each section independently
  const sections = [
    'new_timeline_events',
    'clock_changes',
    'npc_changes',
    'pc_changes',
    'faction_changes',
    'organic_advancement',
    'notes_for_gm'
  ]

  for (const section of sections) {
    if (rawUpdates[section]) {
      try {
        // Attempt basic validation - just check it's an array or string
        if (Array.isArray(rawUpdates[section]) && rawUpdates[section].length > 0) {
          validated[section] = rawUpdates[section]
        } else if (typeof rawUpdates[section] === 'string') {
          validated[section] = rawUpdates[section]
        }
      } catch (error) {
        console.warn(`⚠️ Could not validate ${section}:`, error)
      }
    }
  }

  return validated
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
