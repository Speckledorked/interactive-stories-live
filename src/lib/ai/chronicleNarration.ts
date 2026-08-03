// src/lib/ai/chronicleNarration.ts
// Campaign lobby "World Chronicle": a few sentences of generated in-world
// atmosphere (weather, faction posture, active conflicts, recent
// happenings), regenerated once per world turn by runWorldTurn and cached
// on WorldMeta.chronicleNarration — never called live per page view.
//
// This replaces WorldSummaryPanel's stat-tile grid in the campaign lobby.
// The design principle behind it (verbatim from the user this session):
// "A dashboard shows you data. A chronicle tells you a story about the
// same data." Structured facts go IN; only prose comes OUT — never a
// table, never a bare count.
//
// Same fail-open shape as every other small-artifact generator in this
// file's neighborhood (calendarGenerator.ts, moveFlavor.ts): no API key
// or any error/malformed response just returns null, and the caller
// (worldTurn.ts) leaves the previous turn's narration in place rather
// than blocking or breaking the page.

import { callChatCompletion } from './chatCompletion'
import { AI_MODELS } from './models'
import { recordAICost, estimateTokenCount } from './cost-tracker'
import type { ChronicleNarrationInput } from '@/lib/game/chronicleTypes'

const MIN_CHARS = 60
const MAX_CHARS = 1400

/**
 * Pure — validates the raw AI JSON response, returns null on anything
 * malformed. Never trusts the model: a response that's empty, absurdly
 * short/long, or still shaped like JSON (the model echoing structure
 * instead of writing prose) is discarded rather than displayed.
 */
export function validateGeneratedChronicle(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const narration = (raw as Record<string, unknown>).narration
  if (typeof narration !== 'string') return null

  const trimmed = narration.trim()
  if (trimmed.length < MIN_CHARS || trimmed.length > MAX_CHARS) return null
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return null

  return trimmed
}

function describeFaction(f: ChronicleNarrationInput['factionSignals'][number]): string {
  const plan = f.currentPlan ? ` Currently: ${f.currentPlan}.` : ''
  return `${f.name} (${f.archetype.toLowerCase()}, pursuing ${f.goal.toLowerCase().replace(/_/g, ' ')}, stability ${f.stability}/100, threat ${f.threatLevel}/100).${plan}`
}

function describeWar(w: ChronicleNarrationInput['activeWars'][number]): string {
  const side = w.momentum > 15 ? `${w.attackerName} has the advantage` : w.momentum < -15 ? `${w.defenderName} has the advantage` : 'neither side has broken the deadlock'
  return `${w.name}: ${w.attackerName} vs ${w.defenderName} — ${side}.`
}

export function buildChronicleNarrationPrompt(input: ChronicleNarrationInput): { system: string; user: string } {
  const system =
    'You write brief, atmospheric in-world narration for a tabletop RPG campaign\'s home page — the feeling of the world right now, not a status report. ' +
    '3-5 sentences, present tense, second-person or omniscient narrator voice, no headers, no bullet points, no numbers, no stats, no meta-commentary. ' +
    'JSON only: {"narration": "..."}'

  const lines: string[] = [
    `Universe: ${input.universe}`,
    `Campaign: "${input.campaignTitle}"`,
    `Narrative tension: ${input.tension}/100${input.phase ? ` (${input.phase} phase)` : ''}`,
  ]

  if (input.weather) {
    lines.push(`Weather in ${input.weather.locationName}: ${input.weather.condition.toLowerCase()} (severity ${input.weather.severity}/5)`)
  }
  if (input.factionSignals.length > 0) {
    lines.push('Faction activity:')
    lines.push(...input.factionSignals.map(f => `- ${describeFaction(f)}`))
  }
  if (input.activeWars.length > 0) {
    lines.push('Active conflicts:')
    lines.push(...input.activeWars.map(w => `- ${describeWar(w)}`))
  }
  if (input.recentEvents.length > 0) {
    lines.push('Recent happenings:')
    lines.push(...input.recentEvents.map(e => `- ${e.title}${e.summaryPublic ? `: ${e.summaryPublic}` : ''}`))
  }

  const user =
    `Write the "world at a glance" narration for this campaign's home page from the facts below. ` +
    `Weave them into flowing prose — never list them back as facts, never mention numbers/percentages directly.\n\n` +
    lines.join('\n')

  return { system, user }
}

/**
 * Generates the chronicle narration for a campaign, or null on any
 * failure (no API key, API error, malformed response). Cost is tracked
 * only on a successful generation — a failed call that never reached the
 * model shouldn't record a cost entry.
 */
export async function generateChronicleNarration(
  campaignId: string,
  input: ChronicleNarrationInput
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const startTime = Date.now()
  const { system, user } = buildChronicleNarrationPrompt(input)

  try {
    const result = await callChatCompletion({
      apiKey,
      model: AI_MODELS.EFFICIENT,
      systemPrompt: system,
      userPrompt: user,
      temperature: 0.85,
      maxTokens: 400,
      jsonMode: true,
    })

    if (!result.ok) {
      console.error('Chronicle narration generation API error:', result.status)
      return null
    }

    let raw: unknown
    try {
      raw = JSON.parse(result.content)
    } catch {
      return null
    }

    const narration = validateGeneratedChronicle(raw)
    if (!narration) return null

    await recordAICost({
      campaignId,
      model: AI_MODELS.EFFICIENT,
      requestType: 'chronicle_narration',
      inputTokens: result.usage.prompt_tokens || estimateTokenCount(system + user),
      outputTokens: result.usage.completion_tokens || estimateTokenCount(narration),
      responseTimeMs: Date.now() - startTime,
      success: true,
    }).catch(console.error)

    return narration
  } catch (err) {
    console.error('Chronicle narration generation failed (lobby keeps last turn\'s narration):', err)
    return null
  }
}
