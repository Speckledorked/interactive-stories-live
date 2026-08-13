// src/lib/game/worldGraph.ts
// World Sim #108 — real location adjacency for NPC and territory targeting.
//
// Zero spatial/adjacency data existed anywhere in this schema before this:
// NPC location targeting (tick/npcTick.ts) picked via a deterministic hash
// rotation, and territory claims (tick/territory.ts's decideTerritoryClaim)
// were a flat alphabetical scan. Both are now adjacency-AWARE, not
// adjacency-DEPENDENT — every function here is optional-input: called with
// no edges (or an unreachable destination), callers fall back to their
// pre-#108 deterministic behavior exactly, so an existing campaign with no
// backfilled graph yet (or a campaign whose graph doesn't yet cover a given
// location pair) never breaks.
//
// LocationAdjacency rows (schema.prisma) are undirected and store the
// lexicographically smaller location id as locationAId — every function
// below expands a row into both directions when building its internal
// graph, so callers never need to worry about which side is A vs B.

export interface AdjacencyEdge {
  locationAId: string
  locationBId: string
  distance: number
}

function buildNeighborMap(edges: AdjacencyEdge[]): Map<string, { neighborId: string; distance: number }[]> {
  const map = new Map<string, { neighborId: string; distance: number }[]>()
  const add = (from: string, to: string, distance: number) => {
    if (!map.has(from)) map.set(from, [])
    map.get(from)!.push({ neighborId: to, distance })
  }
  for (const edge of edges) {
    add(edge.locationAId, edge.locationBId, edge.distance)
    add(edge.locationBId, edge.locationAId, edge.distance)
  }
  return map
}

/** Every location directly adjacent to `locationId` (one hop), regardless
 * of which side of a LocationAdjacency row they were stored on. */
export function directNeighborsOf(edges: AdjacencyEdge[], locationId: string): string[] {
  const neighbors = new Set<string>()
  for (const edge of edges) {
    if (edge.locationAId === locationId) neighbors.add(edge.locationBId)
    if (edge.locationBId === locationId) neighbors.add(edge.locationAId)
  }
  return [...neighbors]
}

export interface ShortestPathResult {
  /** Location ids from start to end, inclusive of both. */
  path: string[]
  distance: number
}

/**
 * A plain binary min-heap keyed by a caller-supplied priority, used only by
 * shortestPath below. Stale entries (a node pushed more than once because a
 * shorter distance to it was discovered after an earlier, worse entry was
 * already queued) are left in place rather than removed — cheaper than a
 * decrease-key operation, and shortestPath already discards a popped entry
 * whose distance doesn't match the current best (see the `if (d >
 * currentBest) continue` check below), so a stale pop is a no-op, not a
 * correctness risk.
 */
class MinHeap<T> {
  private items: { priority: number; value: T }[] = []

  get size(): number {
    return this.items.length
  }

  push(priority: number, value: T): void {
    this.items.push({ priority, value })
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.items[parent].priority <= this.items[i].priority) break
      ;[this.items[parent], this.items[i]] = [this.items[i], this.items[parent]]
      i = parent
    }
  }

  pop(): { priority: number; value: T } | undefined {
    const top = this.items[0]
    const last = this.items.pop()
    if (this.items.length > 0 && last) {
      this.items[0] = last
      let i = 0
      for (;;) {
        const left = i * 2 + 1
        const right = i * 2 + 2
        let smallest = i
        if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) smallest = left
        if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) smallest = right
        if (smallest === i) break
        ;[this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]]
        i = smallest
      }
    }
    return top
  }
}

/**
 * Pure — Dijkstra's algorithm over a flat, undirected, non-negative-weight
 * edge list. Binary-heap node selection (O((V+E) log V)) — #259, replacing
 * an earlier O(V^2) linear scan that was fine at this codebase's real scale
 * (tens of locations per campaign) but not built for more. Returns null
 * when no path exists (disconnected graph, or either id isn't present in
 * any edge). Where multiple shortest paths tie in total distance, WHICH
 * one is returned can differ from the old linear-scan implementation (both
 * are valid Dijkstra runs; visitation order on a tie was never a
 * documented guarantee of this function) — only the distance, and the
 * validity of the returned path, are the actual contract.
 */
export function shortestPath(edges: AdjacencyEdge[], fromLocationId: string, toLocationId: string): ShortestPathResult | null {
  if (fromLocationId === toLocationId) return { path: [fromLocationId], distance: 0 }

  const neighbors = buildNeighborMap(edges)
  const distances = new Map<string, number>([[fromLocationId, 0]])
  const previous = new Map<string, string>()
  const visited = new Set<string>()
  const heap = new MinHeap<string>()
  heap.push(0, fromLocationId)

  while (heap.size > 0) {
    const popped = heap.pop()!
    const current = popped.value
    const currentDistance = popped.priority

    // Stale entry: a better distance to this node was already found and
    // finalized (or queued) after this entry was pushed. Skip rather than
    // reprocess — the decrease-key-avoidance tradeoff MinHeap's own doc
    // comment describes.
    if (currentDistance > (distances.get(current) ?? Infinity)) continue
    if (visited.has(current)) continue
    visited.add(current)
    if (current === toLocationId) break

    for (const { neighborId, distance } of neighbors.get(current) ?? []) {
      if (visited.has(neighborId)) continue
      const candidateDistance = currentDistance + distance
      if (candidateDistance < (distances.get(neighborId) ?? Infinity)) {
        distances.set(neighborId, candidateDistance)
        previous.set(neighborId, current)
        heap.push(candidateDistance, neighborId)
      }
    }
  }

  if (!distances.has(toLocationId)) return null

  const path: string[] = [toLocationId]
  let node = toLocationId
  while (node !== fromLocationId) {
    const prev = previous.get(node)
    if (!prev) return null
    path.unshift(prev)
    node = prev
  }
  return { path, distance: distances.get(toLocationId)! }
}

export interface NearestLocationResult {
  locationId: string
  distance: number
}

/**
 * Pure — which of `candidateIds` is nearest to `fromLocationId` by real
 * graph distance. Ties broken by id so the result is deterministic
 * regardless of input order. Returns null if none of the candidates are
 * reachable at all (disconnected graph, or no edges).
 */
export function nearestLocation(edges: AdjacencyEdge[], fromLocationId: string, candidateIds: string[]): NearestLocationResult | null {
  let best: NearestLocationResult | null = null
  for (const candidateId of candidateIds) {
    const result = shortestPath(edges, fromLocationId, candidateId)
    if (!result) continue
    if (!best || result.distance < best.distance || (result.distance === best.distance && candidateId < best.locationId)) {
      best = { locationId: candidateId, distance: result.distance }
    }
  }
  return best
}
