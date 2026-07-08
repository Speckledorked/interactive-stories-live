// src/lib/ai/models.ts
// Central OpenAI model configuration. Every call site imports from here
// instead of hardcoding a model string, so rolling out a new generation is
// a one-file change instead of a grep-and-replace across the codebase.
//
// Verified against https://developers.openai.com/api/docs/pricing on
// 2026-07-08 — gpt-4.1 / gpt-4.1-mini no longer appeared in the current
// lineup there, superseded by the gpt-5.4 series. If OpenAI has renamed or
// deprecated these since, this is the only place that needs updating.
export const AI_MODELS = {
  // Narrative-critical calls where output quality matters most: main scene
  // resolution, new-scene intros.
  FLAGSHIP: 'gpt-5.4',
  // Structured extraction / background tasks where a smaller, cheaper model
  // is appropriate: map layout extraction, consequence extraction, offscreen
  // event generation, stub NPC/faction enrichment, world generation.
  EFFICIENT: 'gpt-5.4-mini',
} as const
