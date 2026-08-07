// src/lib/ai/clockResolutionEffects.ts
// Decides what, if anything, mechanically follows from a completed GENERIC
// (non-ambition) clock — the counterpart to how a faction ambition clock
// already resolves into a real stat outcome (ambitionResolution.ts), for
// GM/world clocks that previously only ever produced a narrated
// TimelineEvent with nothing behind it.
//
// Same closed-catalogue discipline as worldRulesGenerator.ts: the AI never
// invents a location/faction name (it's only ever allowed to pick from the
// real names it's handed) and never invents an effect shape (only the 3
// registered types below). game/tick/clockResolutionEffects.ts is what
// actually resolves those names against real rows and clamps every delta —
// this file only produces a candidate, bounded verdict.
//
// Same fail-open shape as chronicleNarration.ts/calendarGenerator.ts: no
// API key or any error/malformed response returns null, and the caller
// (worldTurn.ts) simply skips mechanical follow-through for that clock —
// the clock still resolves into its existing narrated TimelineEvent
// regardless (see stateUpdater.ts's checkAndResolveCompletedClocks), so a
// failed or skipped generation never leaves the completion unacknowledged.

import { callChatCompletion } from './chatCompletion'
import { AI_MODELS } from './models'
import { recordAICost, estimateTokenCount } from './cost-tracker'
import {
  ClockResolutionEffect,
  ClockResolutionEffectType,
  MAX_EFFECTS_PER_CLOCK,
  SPAWN_CLOCK_MIN_TICKS,
  SPAWN_CLOCK_MAX_TICKS,
  MAX_FACTION_STAT_DELTA,
  MAX_THREAT_LEVEL_DELTA,
  MAX_LOCATION_CONDITION_DELTA,
} from '@/lib/game/tick/clockResolutionTypes'

const EFFECT_TYPES: ClockResolutionEffectType[] = ['SPAWN_CLOCK', 'LOCATION_EFFECT', 'FACTION_EFFECT']

export interface ClockResolutionContext {
  campaignTitle: string
  universe: string
  clockName: string
  clockDescription: string | null
  clockConsequence: string | null
  clockGmNotes: string | null
  clockCategory: string | null
  // Real entity names the AI is allowed to target — never invented.
  knownLocationNames: string[]
  knownFactionNames: string[]
}

const REASON_MAX_CHARS = 300
const NAME_MAX_CHARS = 200
const CONSEQUENCE_MAX_CHARS = 1000

function clampNum(value: unknown, min: number, max: number): number | undefined {
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  return Math.max(min, Math.min(max, Math.round(n)))
}

function trimmedString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, maxChars)
}

/**
 * Validates one raw effect entry, returning null on anything that doesn't
 * satisfy its type's required shape — an invalid entry is dropped, not
 * repaired or guessed at. Pure; never trusts the model.
 */
function validateOneEffect(raw: unknown): ClockResolutionEffect | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const rawType = r.type
  if (typeof rawType !== 'string' || !EFFECT_TYPES.includes(rawType as ClockResolutionEffectType)) return null
  const type = rawType as ClockResolutionEffectType
  const reason = trimmedString(r.reason, REASON_MAX_CHARS) ?? ''

  if (type === 'SPAWN_CLOCK') {
    const name = trimmedString(r.name, NAME_MAX_CHARS)
    const consequence = trimmedString(r.consequence, CONSEQUENCE_MAX_CHARS)
    if (!name || !consequence) return null
    return {
      type,
      reason,
      name,
      consequence,
      category: trimmedString(r.category, 100) ?? null,
      maxTicks: clampNum(r.max_ticks, SPAWN_CLOCK_MIN_TICKS, SPAWN_CLOCK_MAX_TICKS) ?? SPAWN_CLOCK_MIN_TICKS,
    }
  }

  if (type === 'LOCATION_EFFECT') {
    const targetLocationName = trimmedString(r.target_location_name, NAME_MAX_CHARS)
    const conditionDelta = clampNum(r.condition_delta, -MAX_LOCATION_CONDITION_DELTA, MAX_LOCATION_CONDITION_DELTA)
    if (!targetLocationName || conditionDelta === undefined) return null
    return { type, reason, targetLocationName, conditionDelta }
  }

  // FACTION_EFFECT
  const targetFactionName = trimmedString(r.target_faction_name, NAME_MAX_CHARS)
  if (!targetFactionName) return null
  const resourceDelta = clampNum(r.resource_delta, -MAX_FACTION_STAT_DELTA, MAX_FACTION_STAT_DELTA) ?? 0
  const stabilityDelta = clampNum(r.stability_delta, -MAX_FACTION_STAT_DELTA, MAX_FACTION_STAT_DELTA) ?? 0
  const militaryDelta = clampNum(r.military_delta, -MAX_FACTION_STAT_DELTA, MAX_FACTION_STAT_DELTA) ?? 0
  const threatLevelDelta = clampNum(r.threat_level_delta, -MAX_THREAT_LEVEL_DELTA, MAX_THREAT_LEVEL_DELTA) ?? 0
  if (resourceDelta === 0 && stabilityDelta === 0 && militaryDelta === 0 && threatLevelDelta === 0) return null
  return { type, reason, targetFactionName, resourceDelta, stabilityDelta, militaryDelta, threatLevelDelta }
}

/**
 * Validates the full raw AI response. A malformed envelope (not an object,
 * no `effects` array) fails the whole response — but once inside the
 * array, each entry is validated independently and an invalid one is
 * dropped rather than discarding every valid one alongside it, same
 * salvage-what's-valid convention as validateAIResponseWithRepair. Caps at
 * MAX_EFFECTS_PER_CLOCK regardless of how many the model returned.
 */
export function validateGeneratedClockEffects(raw: unknown): ClockResolutionEffect[] | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.effects)) return null

  const effects: ClockResolutionEffect[] = []
  for (const entry of r.effects) {
    const validated = validateOneEffect(entry)
    if (validated) effects.push(validated)
    if (effects.length >= MAX_EFFECTS_PER_CLOCK) break
  }
  return effects
}

export function buildClockResolutionPrompt(context: ClockResolutionContext): { system: string; user: string } {
  const system =
    'You decide what mechanically follows, if anything, from a completed tabletop RPG world-event clock — from a small closed set of effect types only. ' +
    'Never invent a location or faction name — only use names from the lists provided, or omit an effect that would need one. ' +
    'It is completely valid, and often correct, to return zero effects. JSON only.'

  const lines: string[] = [
    `Universe: ${context.universe}`,
    `Campaign: "${context.campaignTitle}"`,
    '',
    'A world clock just completed:',
    `Name: ${context.clockName}`,
  ]
  if (context.clockDescription) lines.push(`Description: ${context.clockDescription}`)
  if (context.clockConsequence) lines.push(`What happens when it completes: ${context.clockConsequence}`)
  if (context.clockGmNotes) lines.push(`GM notes: ${context.clockGmNotes}`)
  if (context.clockCategory) lines.push(`Category: ${context.clockCategory}`)
  lines.push('')
  lines.push(`Known locations you may target: ${context.knownLocationNames.length > 0 ? context.knownLocationNames.join(', ') : '(none)'}`)
  lines.push(`Known factions you may target: ${context.knownFactionNames.length > 0 ? context.knownFactionNames.join(', ') : '(none)'}`)
  lines.push('')
  lines.push(
    `Decide what, if anything, mechanically follows from this completing — up to ${MAX_EFFECTS_PER_CLOCK} effects, chosen ONLY if the fiction above genuinely supports them.`
  )
  lines.push('')
  lines.push('Available effect types:')
  lines.push(
    '- SPAWN_CLOCK: this event is not really "over" — it starts a new ongoing threat or opportunity. Provide name, max_ticks (3-8), consequence (what happens when THIS one completes), category (short label).'
  )
  lines.push(
    '- LOCATION_EFFECT: a KNOWN location\'s condition changes as a direct result. Provide target_location_name (from the list above), condition_delta (-15 to 15, negative = worse/more dangerous), reason.'
  )
  lines.push(
    '- FACTION_EFFECT: a KNOWN faction is directly affected. Provide target_faction_name (from the list above), and any of resource_delta/stability_delta/military_delta (-10 to 10 each) / threat_level_delta (-1 to 1), reason.'
  )
  lines.push('')
  lines.push('Return JSON: { "effects": [ { "type": "...", ...fields for that type... } ] }')
  lines.push('Never target a location or faction not in the lists above. Omit an effect type entirely rather than guessing a name.')

  return { system, user: lines.join('\n') }
}

/**
 * Generates candidate mechanical effects for a completed generic clock, or
 * null on any failure (no API key, API error, malformed response, or
 * nothing worth applying). Cost is tracked only on a successful call that
 * actually reached the model.
 */
export async function generateClockResolutionEffects(
  campaignId: string,
  context: ClockResolutionContext
): Promise<ClockResolutionEffect[] | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const startTime = Date.now()
  const { system, user } = buildClockResolutionPrompt(context)

  try {
    const result = await callChatCompletion({
      apiKey,
      model: AI_MODELS.EFFICIENT,
      systemPrompt: system,
      userPrompt: user,
      temperature: 0.6,
      maxTokens: 500,
      jsonMode: true,
    })

    if (!result.ok) {
      console.error('Clock resolution effects generation API error:', result.status)
      return null
    }

    let raw: unknown
    try {
      raw = JSON.parse(result.content)
    } catch {
      return null
    }

    const effects = validateGeneratedClockEffects(raw)
    if (effects === null) return null

    await recordAICost({
      campaignId,
      model: AI_MODELS.EFFICIENT,
      requestType: 'clock_resolution_effects',
      inputTokens: result.usage.prompt_tokens || estimateTokenCount(system + user),
      outputTokens: result.usage.completion_tokens || estimateTokenCount(JSON.stringify(effects)),
      responseTimeMs: Date.now() - startTime,
      success: true,
    }).catch(console.error)

    return effects
  } catch (err) {
    console.error('Clock resolution effects generation failed (clock still resolves via its narrated event only):', err)
    return null
  }
}
