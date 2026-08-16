// src/lib/game/__tests__/defaultAdjacency.test.ts
// #379: the default world graph.
//
// LocationAdjacency had one writer, reachable only through the lore-import
// pipeline, so every other campaign had an empty table while five
// subsystems read it — and all five fall back silently, which is why the
// absence was invisible.
//
// What matters about the shape is not "there are edges" but that the graph
// preserves the property its consumers depend on: a real spread of hop
// distances. A fully-connected graph would technically populate the table
// and still collapse informationTick's latency model to a constant.

import { describe, it, expect } from 'vitest'
import { buildDefaultAdjacency } from '../defaultAdjacency'

/** Breadth-first hop count between two ids over the built graph. */
function hops(edges: ReturnType<typeof buildDefaultAdjacency>, from: string, to: string): number {
  const neighbours = new Map<string, string[]>()
  for (const e of edges) {
    neighbours.set(e.locationAId, [...(neighbours.get(e.locationAId) ?? []), e.locationBId])
    neighbours.set(e.locationBId, [...(neighbours.get(e.locationBId) ?? []), e.locationAId])
  }
  const seen = new Set([from])
  let frontier = [from]
  let depth = 0
  while (frontier.length > 0) {
    if (frontier.includes(to)) return depth
    depth++
    frontier = frontier.flatMap((id) => neighbours.get(id) ?? []).filter((id) => !seen.has(id) && seen.add(id))
  }
  return Infinity
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `loc${String(i).padStart(2, '0')}`)

describe('buildDefaultAdjacency', () => {
  it('connects every location to every other', () => {
    // Connectivity is the property the five consumers actually need. A
    // disconnected graph means information that can never arrive.
    const all = ids(10)
    const edges = buildDefaultAdjacency(all)

    for (const target of all.slice(1)) {
      expect(hops(edges, all[0], target)).toBeLessThan(Infinity)
    }
  })

  it('keeps a real spread of distances rather than making everything adjacent', () => {
    // A fully-connected graph would populate the table and still collapse
    // informationTick's latency model to a constant, making its distortion
    // tiers unreachable — a graph that removes the distances is barely
    // better than no graph at all.
    const all = ids(12)
    const edges = buildDefaultAdjacency(all)

    const distances = all.slice(1).map((target) => hops(edges, all[0], target))
    expect(Math.max(...distances)).toBeGreaterThan(1)
  })

  it('keeps the diameter small enough for news to cross', () => {
    // A pure chain would be connected and have an O(n) diameter, so word
    // from the far end takes implausibly long. The chords are what bound
    // this.
    const all = ids(24)
    const edges = buildDefaultAdjacency(all)

    const distances = all.slice(1).map((target) => hops(edges, all[0], target))
    expect(Math.max(...distances)).toBeLessThan(all.length / 2)
  })

  it('is deterministic — the same world builds the same graph', () => {
    // Composes with the tick's own determinism guarantee; a second run
    // must not produce a second, different map.
    expect(buildDefaultAdjacency(ids(9))).toEqual(buildDefaultAdjacency(ids(9)))
  })

  it('canonicalizes each edge so skipDuplicates actually deduplicates', () => {
    // LocationAdjacency's @@unique documents locationAId as the
    // lexicographically smaller id; without that, the same pair inserted
    // from either direction is two rows.
    for (const edge of buildDefaultAdjacency(ids(8))) {
      expect(edge.locationAId < edge.locationBId).toBe(true)
    }
  })

  it('emits no duplicate pairs even where a ring edge and a chord coincide', () => {
    const edges = buildDefaultAdjacency(ids(5))
    const keys = edges.map((e) => `${e.locationAId}|${e.locationBId}`)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('handles worlds too small for a ring', () => {
    expect(buildDefaultAdjacency([])).toEqual([])
    expect(buildDefaultAdjacency(['only'])).toEqual([])
    expect(buildDefaultAdjacency(['b', 'a'])).toEqual([{ locationAId: 'a', locationBId: 'b', distance: 1 }])
  })

  it('ignores duplicate ids rather than linking a location to itself', () => {
    const edges = buildDefaultAdjacency(['a', 'a', 'b'])

    expect(edges).toEqual([{ locationAId: 'a', locationBId: 'b', distance: 1 }])
  })
})
