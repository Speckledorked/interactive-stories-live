// src/lib/ai/tokenBudget.ts
//
// #117: buildOptimizedWorldSummary's entity-count caps (MAX_NPCS_IN_PROMPT
// etc.) and clampPromptStrings' per-string character clamp are both FIXED —
// applied the same regardless of how large the assembled request actually
// ends up. This is the finer-grained final pass layered on top of them: a
// real token-budget check against the fully-assembled world_summary +
// current_scene_intro, trimming whole sections in priority order — never
// individual strings, that's clampPromptStrings' job — until under a
// configured ceiling.
//
// Priority order, LOWEST priority trimmed FIRST (decided 2026-08-02):
//   1. World-summary macro detail — RAG recall (relevant_lore/
//      relevant_campaign_history), the campaign-overview blurb, the
//      timeline, then the npc/faction/war/quest/location/clock arrays.
//   2. Recent-scene text (current_scene_intro).
//   3. Character sheets (world_summary.characters) — protected longest,
//      and even then only trimmed down to the PCs actually in this scene,
//      never below that floor.
//
// estimateTokenCount (cost-tracker.ts) is a rough ~4-chars-per-token
// heuristic, same one already used for cost logging — good enough for a
// budget check, not meant to be exact.

import { estimateTokenCount } from './cost-tracker'
import { truncateFromStart } from '@/lib/format'
import type { AIGMRequest } from './client'

// A starting estimate, not a measured figure (no live token-count
// verification was available while building this — see the lore-seeding
// plan's own caution about the same kind of number). Generous enough that
// today's typical campaign never hits it, while still bounding the
// pathological case (a large, long-running campaign with many discovered
// entities) that the fixed entity-count caps alone don't protect against.
//
// #230: this single budget is applied ONCE, upstream of callAIGM, and the
// resulting request is reused byte-identical for both AI_MODELS.FLAGSHIP
// and its AI_MODELS.EFFICIENT fallback (client.ts's attemptAIGM) — there is
// no separate, smaller budget for the fallback attempt. That's safe only
// because the two models share a context window: gpt-5.4-mini is the
// "mini" variant WITHIN the gpt-5.4 generation (models.ts), and every
// OpenAI model family to date (gpt-4/gpt-4-mini, gpt-4.1/gpt-4.1-mini,
// o1/o1-mini, ...) ships its mini variant with the SAME context window as
// its flagship — the mini tier trades latency/cost, not context length.
// 12000 tokens is also tiny relative to any GPT-4/5-class context window
// (all six-figure-plus), so there is no realistic scenario where EFFICIENT
// would reject a request FLAGSHIP accepted purely on size. This is reasoned
// from OpenAI's consistent naming/family convention, not a number pulled
// from a live API call (no OPENAI_API_KEY was available while confirming
// this) — worth a real check against OpenAI's current model documentation
// before leaning on it for anything more safety-critical than prompt sizing.
export const DEFAULT_TOKEN_BUDGET = 12000

// #231: below this many characters, a halved current_scene_intro reads as
// noise rather than continuity — roughly enough for one short sentence of
// "what just happened," matching the tier's own stated purpose.
const MIN_SCENE_INTRO_CHARS = 300

export interface TokenBudgetInput {
  worldSummary: AIGMRequest['world_summary']
  currentSceneIntro: string
  /** PCs actually in the current scene, or null for a genuinely open scene
   * (the full living roster is in play, so there's no sub-list to prefer —
   * see buildOptimizedWorldSummary's participantCharacterIds). Only used to
   * decide how far character sheets can be trimmed in the last, most-
   * protected tier. */
  participantCharacterIds: string[] | null
}

export interface TokenBudgetResult {
  worldSummary: AIGMRequest['world_summary']
  currentSceneIntro: string
  /** Which trim steps actually fired, in the order they fired. Empty when
   * the input was already under budget. For logging/tests, not the prompt. */
  stepsApplied: string[]
}

function estimatedTokens(worldSummary: AIGMRequest['world_summary'], currentSceneIntro: string): number {
  return estimateTokenCount(JSON.stringify(worldSummary)) + estimateTokenCount(currentSceneIntro)
}

/** Keeps the first half of an array (callers already sort by
 * importance/recency before this ever runs), leaving 0/1-length arrays
 * alone since there's nothing left to usefully halve. */
function halved<T>(arr: T[] | undefined): T[] | undefined {
  if (!Array.isArray(arr) || arr.length <= 1) return arr
  return arr.slice(0, Math.ceil(arr.length / 2))
}

/**
 * Pure. Applies trim steps in priority order, re-checking the estimate
 * after each one and stopping as soon as it's under budget — never trims
 * more than it has to, and a well-behaved (small) request is returned
 * completely unchanged.
 */
export function applyTokenBudget(
  input: TokenBudgetInput,
  maxTokens: number = DEFAULT_TOKEN_BUDGET
): TokenBudgetResult {
  let worldSummary = input.worldSummary
  let currentSceneIntro = input.currentSceneIntro
  const stepsApplied: string[] = []

  const underBudget = () => estimatedTokens(worldSummary, currentSceneIntro) <= maxTokens

  if (underBudget()) {
    return { worldSummary, currentSceneIntro, stepsApplied }
  }

  // Tier 1 (lowest priority, trimmed first): world-summary macro detail.
  // Ordered least-central-to-continuity first: imported reference lore and
  // RAG-recalled history are recall AIDS, not the scene itself, so they go
  // before anything the world state actually depends on. Each step also
  // declares whether it has anything left to give — a step with nothing to
  // trim is skipped (not applied, not logged) rather than counted as a
  // no-op "trim" that didn't actually shrink anything.
  const tier1Steps: Array<[string, () => boolean, () => void]> = [
    ['relevant_lore',
      () => (worldSummary.relevant_lore?.length ?? 0) > 0,
      () => { worldSummary = { ...worldSummary, relevant_lore: [] } }],
    ['relevant_campaign_history',
      () => (worldSummary.relevant_campaign_history?.length ?? 0) > 0,
      () => { worldSummary = { ...worldSummary, relevant_campaign_history: [] } }],
    ['_campaignSummary',
      () => !!worldSummary._campaignSummary,
      () => { worldSummary = { ...worldSummary, _campaignSummary: undefined } }],
    ['recent_timeline_events',
      () => worldSummary.recent_timeline_events.length > 1,
      () => { worldSummary = { ...worldSummary, recent_timeline_events: halved(worldSummary.recent_timeline_events) ?? [] } }],
    ['wars_quests_locations_clocks',
      () => [worldSummary.wars, worldSummary.quests, worldSummary.locations, worldSummary.clocks].some((arr) => (arr?.length ?? 0) > 1),
      () => {
        worldSummary = {
          ...worldSummary,
          wars: halved(worldSummary.wars),
          quests: halved(worldSummary.quests),
          locations: halved(worldSummary.locations),
          clocks: halved(worldSummary.clocks) ?? worldSummary.clocks,
        }
      }],
    ['npcs',
      () => worldSummary.npcs.length > 1,
      () => { worldSummary = { ...worldSummary, npcs: halved(worldSummary.npcs) ?? worldSummary.npcs } }],
    ['factions',
      () => worldSummary.factions.length > 1,
      () => { worldSummary = { ...worldSummary, factions: halved(worldSummary.factions) ?? worldSummary.factions } }],
  ]

  for (const [name, hasContent, apply] of tier1Steps) {
    if (underBudget()) break
    if (!hasContent()) continue
    apply()
    stepsApplied.push(name)
  }
  if (underBudget()) {
    return { worldSummary, currentSceneIntro, stepsApplied }
  }

  // Tier 2: recent-scene text. Halves it rather than dropping it outright —
  // some continuity beats none. Critically, this keeps the END of the
  // string, not the start: sceneResolutionRequest.ts builds this as
  // [original scene framing] + "What Has Happened Recently" + [the last
  // two exchanges, oldest first, MOST RECENT LAST]. Cutting from the end
  // (truncateWithEllipsis) would throw away exactly the freshest exchange
  // first — the one piece of continuity that actually prevents the next
  // exchange from re-narrating a beat that just happened. The original
  // scene-intro framing is comparatively cheap to lose once several
  // exchanges have piled up; what just happened is not.
  // #231: halving has no floor of its own — on a pathologically small
  // budget the result could shrink to a near-empty, incoherent fragment
  // ("...t") rather than degrading gracefully. Below MIN_SCENE_INTRO_CHARS,
  // a fragment that short isn't "less continuity," it's noise — drop the
  // scene intro entirely instead of handing the model something unreadable.
  if (currentSceneIntro.length > 0) {
    const halvedLength = Math.ceil(currentSceneIntro.length / 2)
    if (halvedLength < MIN_SCENE_INTRO_CHARS) {
      currentSceneIntro = ''
      stepsApplied.push('current_scene_intro_dropped')
    } else {
      currentSceneIntro = truncateFromStart(currentSceneIntro, halvedLength)
      stepsApplied.push('current_scene_intro')
    }
  }
  if (underBudget()) {
    return { worldSummary, currentSceneIntro, stepsApplied }
  }

  // Tier 3 (protected longest): character sheets. Only narrows to the PCs
  // actually in THIS scene — never drops below that floor even if still
  // over budget afterward, and does nothing at all for a genuinely open
  // scene (participantCharacterIds === null), since there's no sub-list to
  // prefer over the full roster in that case.
  if (
    input.participantCharacterIds !== null &&
    Array.isArray(worldSummary.characters) &&
    input.participantCharacterIds.length > 0
  ) {
    const participants = new Set(input.participantCharacterIds)
    const onlyParticipants = worldSummary.characters.filter((c) => participants.has(c.id))
    if (onlyParticipants.length > 0 && onlyParticipants.length < worldSummary.characters.length) {
      worldSummary = { ...worldSummary, characters: onlyParticipants }
      stepsApplied.push('characters')
    }
  }

  return { worldSummary, currentSceneIntro, stepsApplied }
}
