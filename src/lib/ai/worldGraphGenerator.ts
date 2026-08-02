// src/lib/ai/worldGraphGenerator.ts
// World Sim #108 — one-time AI-authored backfill of a campaign's
// LocationAdjacency graph. Same fail-open shape as calendarGenerator.ts/
// worldRulesGenerator.ts: a failed or missing call just means the
// campaign keeps whatever adjacency data it already has (none, on a
// fresh campaign) — worldGraph.ts's functions are all optional-input, so
// an empty graph degrades to their pre-#108 fallback behavior, never an
// error.
//
// Unlike worldRulesGenerator.ts's closed-catalogue verdicts, there's no
// fixed set of "possible edges" to choose among here — the AI is asked to
// infer a plausible graph over THIS campaign's own named locations, which
// varies per campaign. The safety net is narrower but still real:
// validateGeneratedEdges drops any edge naming a location outside the
// real, campaign-supplied list (so the AI can't invent a place that
// doesn't exist) and clamps distance into a small sane range.

import { callChatCompletion } from './chatCompletion'
import { AI_MODELS } from './models'

export interface GeneratedAdjacencyEdge {
  locationAName: string
  locationBName: string
  distance: number
}

const MIN_DISTANCE = 1
const MAX_DISTANCE = 10

function validateGeneratedEdges(raw: unknown, knownNames: Set<string>): GeneratedAdjacencyEdge[] | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.edges)) return null

  const edges: GeneratedAdjacencyEdge[] = []
  const seenPairs = new Set<string>()
  for (const entry of r.edges as Array<Record<string, unknown>>) {
    if (!entry || typeof entry !== 'object') continue
    const a = typeof entry.location_a === 'string' ? entry.location_a.trim() : ''
    const b = typeof entry.location_b === 'string' ? entry.location_b.trim() : ''
    if (!a || !b || a === b) continue
    if (!knownNames.has(a) || !knownNames.has(b)) continue

    const distance = Number(entry.distance)
    if (!Number.isFinite(distance)) continue
    const clampedDistance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, Math.round(distance)))

    // Same pair either order counts as a duplicate — the AI has no notion
    // of the A/B canonicalization this data ends up stored under.
    const pairKey = [a, b].sort().join('::')
    if (seenPairs.has(pairKey)) continue
    seenPairs.add(pairKey)

    edges.push({ locationAName: a, locationBName: b, distance: clampedDistance })
  }
  return edges
}

/**
 * Infer a plausible adjacency graph over a campaign's own named locations,
 * grounded in their descriptions and (if given) a lore digest. Returns
 * null on no API key, an API error, a malformed/empty response, or fewer
 * than 2 real locations to connect at all — never throws.
 */
export async function generateWorldGraph(
  campaignTitle: string,
  campaignDescription: string,
  universe: string,
  locations: { name: string; description: string | null }[],
  loreDigest?: string
): Promise<GeneratedAdjacencyEdge[] | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  if (locations.length < 2) return null

  const locationList = locations.map((l) => `- ${l.name}${l.description ? `: ${l.description}` : ''}`).join('\n')

  const prompt = `You are inferring plausible geographic adjacency between named locations in a tabletop RPG campaign, so a world-simulation engine can reason about travel distance and reachability.

Universe: ${universe}
Campaign: "${campaignTitle}"${campaignDescription ? `\nDescription: "${campaignDescription}"` : ''}
${loreDigest ? `\nCanon excerpts:\n${loreDigest}\n` : ''}
Known locations:
${locationList}

Infer which of these locations plausibly border or directly connect to one another, based on their names, descriptions, and the fiction above. Aim for a connected map where most locations can reach most others through some chain of edges — avoid leaving locations completely isolated unless the fiction specifically suggests true isolation (a hidden sanctum, a distant otherworldly realm).

Return JSON:
{
  "edges": [
    { "location_a": "...", "location_b": "...", "distance": integer 1-10 }
  ]
}

Use location names EXACTLY as given above — never invent a location not in the list. distance is a relative travel-difficulty scale (1 = adjacent/short trip, 10 = a long, arduous journey), not real-world units.`

  try {
    const result = await callChatCompletion({
      apiKey,
      model: AI_MODELS.EFFICIENT,
      systemPrompt: 'You infer plausible geographic adjacency between named locations in a tabletop RPG campaign. JSON only. You never invent a location not given to you.',
      userPrompt: prompt,
      temperature: 0.6,
      maxTokens: 1500,
      jsonMode: true,
    })

    if (!result.ok) {
      console.error('World graph generation API error:', result.status)
      return null
    }

    const raw = JSON.parse(result.content)
    const edges = validateGeneratedEdges(raw, new Set(locations.map((l) => l.name)))
    if (!edges || edges.length === 0) {
      console.error('World graph generation returned an invalid or empty shape')
      return null
    }

    console.log(`✅ World graph generated: ${edges.length} adjacency edge(s) across ${locations.length} locations`)
    return edges
  } catch (err) {
    console.error('World graph generation failed (campaign keeps whatever adjacency data it already has):', err)
    return null
  }
}
