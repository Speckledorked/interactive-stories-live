// src/lib/game/defaultAdjacency.ts
// #379: a world graph for campaigns that didn't come from imported lore.
//
// LocationAdjacency had exactly one writer — reseedWorld.ts, reachable only
// through the lore-import pipeline. Every campaign created any other way
// had an EMPTY adjacency table, and five subsystems read it:
//
//   informationTick (hop distance for latency and distortion),
//   npcTick (work-location selection),
//   migrationTick, logisticsTick (supply routes), ambitionResolution.
//
// All five fall back silently. None logs, warns or degrades visibly — they
// take a non-graph path and continue, so the feature appears to work while
// being structurally absent. The knock-on is visible in play: with no
// graph, npcTick's location selection degenerates to walking an
// alphabetical list, which (with the frozen turn counter) put every NPC in
// lockstep through the same order.
//
// Same shape as the resourceSlots gap: a graph-backed feature whose graph
// is populated by exactly one optional pipeline, with a defensive fallback
// that makes total absence indistinguishable from a sparse graph.
//
// This builds a default topology from the locations a campaign already has.
// It is not a substitute for authored geography — imported lore still
// produces a real map, and this never overwrites it — but it is the
// difference between five subsystems running and five subsystems silently
// not.

export interface AdjacencyEdgeInput {
  locationAId: string
  locationBId: string
  distance: number
}

/**
 * A connected ring with chords.
 *
 * Chosen deliberately over the two obvious alternatives:
 *
 *   - A fully-connected graph would make every location one hop from every
 *     other, which collapses informationTick's latency model to a constant
 *     and makes the distortion tiers unreachable. A graph that removes the
 *     distances is barely better than no graph.
 *   - A pure chain gives one path and an O(n) diameter, so news from the
 *     far end takes implausibly long and any cut disconnects the world.
 *
 * A ring guarantees connectivity and two routes between any pair; the
 * chords (every location linked to the one three positions along) pull the
 * diameter down to something a rumor can actually cross, while keeping a
 * real spread of hop counts for latency to work with.
 *
 * Deterministic: same location order in, same graph out. No randomness, so
 * this composes with the tick's own determinism guarantee.
 *
 * Callers pass locations in a stable order (id-sorted) so a re-run produces
 * the same edges rather than a second, different graph.
 */
export function buildDefaultAdjacency(locationIds: string[]): AdjacencyEdgeInput[] {
  const ids = Array.from(new Set(locationIds))
  // Fewer than three locations cannot form a ring; two get a single edge,
  // one or zero get nothing, and all three cases are correct rather than
  // degenerate.
  if (ids.length < 2) return []
  if (ids.length === 2) return [edge(ids[0], ids[1], 1)]

  const edges = new Map<string, AdjacencyEdgeInput>()
  const add = (a: string, b: string, distance: number) => {
    const e = edge(a, b, distance)
    const key = `${e.locationAId}|${e.locationBId}`
    // First writer wins: a ring edge (distance 1) must not be replaced by
    // a chord (distance 2) for the same pair in a small world where the
    // two coincide.
    if (!edges.has(key)) edges.set(key, e)
  }

  for (let i = 0; i < ids.length; i++) {
    add(ids[i], ids[(i + 1) % ids.length], 1)
  }

  // Chords only once the ring is long enough for them to shorten anything.
  const CHORD_STRIDE = 3
  if (ids.length > CHORD_STRIDE + 1) {
    for (let i = 0; i < ids.length; i++) {
      add(ids[i], ids[(i + CHORD_STRIDE) % ids.length], 2)
    }
  }

  return [...edges.values()]
}

/**
 * Canonicalized so locationAId is always the lexicographically smaller id
 * — the convention LocationAdjacency's @@unique documents, and what makes
 * skipDuplicates actually deduplicate.
 */
function edge(a: string, b: string, distance: number): AdjacencyEdgeInput {
  const [locationAId, locationBId] = a < b ? [a, b] : [b, a]
  return { locationAId, locationBId, distance }
}
