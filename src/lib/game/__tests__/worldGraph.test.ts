import { describe, it, expect } from 'vitest'
import { shortestPath, nearestLocation, directNeighborsOf, graphDiameter } from '../worldGraph'

describe('directNeighborsOf (#108)', () => {
  it('finds neighbors regardless of which side a location was stored on', () => {
    const edges = [
      { locationAId: 'a', locationBId: 'b', distance: 1 },
      { locationAId: 'c', locationBId: 'a', distance: 1 },
    ]
    expect(directNeighborsOf(edges, 'a').sort()).toEqual(['b', 'c'])
  })

  it('returns an empty array for a location with no edges at all', () => {
    expect(directNeighborsOf([{ locationAId: 'x', locationBId: 'y', distance: 1 }], 'a')).toEqual([])
  })

  it('never returns duplicates even with parallel edges', () => {
    const edges = [
      { locationAId: 'a', locationBId: 'b', distance: 1 },
      { locationAId: 'a', locationBId: 'b', distance: 2 },
    ]
    expect(directNeighborsOf(edges, 'a')).toEqual(['b'])
  })
})

describe('shortestPath (#108)', () => {
  it('returns zero distance and a single-node path for the same start/end', () => {
    expect(shortestPath([], 'a', 'a')).toEqual({ path: ['a'], distance: 0 })
  })

  it('returns null when no path exists at all', () => {
    const edges = [{ locationAId: 'a', locationBId: 'b', distance: 1 }]
    expect(shortestPath(edges, 'a', 'z')).toBeNull()
  })

  it('finds a direct one-hop path', () => {
    const edges = [{ locationAId: 'a', locationBId: 'b', distance: 3 }]
    expect(shortestPath(edges, 'a', 'b')).toEqual({ path: ['a', 'b'], distance: 3 })
  })

  it('finds a multi-hop path summing distances along the way', () => {
    const edges = [
      { locationAId: 'a', locationBId: 'b', distance: 2 },
      { locationAId: 'b', locationBId: 'c', distance: 3 },
    ]
    expect(shortestPath(edges, 'a', 'c')).toEqual({ path: ['a', 'b', 'c'], distance: 5 })
  })

  it('picks the shorter of two available routes', () => {
    const edges = [
      { locationAId: 'a', locationBId: 'b', distance: 10 },
      { locationAId: 'a', locationBId: 'c', distance: 1 },
      { locationAId: 'c', locationBId: 'b', distance: 1 },
    ]
    expect(shortestPath(edges, 'a', 'b')).toEqual({ path: ['a', 'c', 'b'], distance: 2 })
  })

  it('treats every edge as undirected regardless of storage side', () => {
    const edges = [{ locationAId: 'b', locationBId: 'a', distance: 4 }]
    expect(shortestPath(edges, 'a', 'b')).toEqual({ path: ['a', 'b'], distance: 4 })
  })

  it('is symmetric — the path from A to B is the reverse of B to A, same distance', () => {
    const edges = [
      { locationAId: 'a', locationBId: 'b', distance: 2 },
      { locationAId: 'b', locationBId: 'c', distance: 3 },
    ]
    const forward = shortestPath(edges, 'a', 'c')!
    const backward = shortestPath(edges, 'c', 'a')!
    expect(backward.distance).toBe(forward.distance)
    expect(backward.path).toEqual([...forward.path].reverse())
  })
})

// #259: shortestPath switched from an O(V^2) linear frontier scan to a
// binary min-heap. These specifically exercise shapes where a naive or
// buggy heap implementation (wrong sift-down comparison, a stale entry
// treated as authoritative instead of being skipped, an off-by-one in
// child-index math) would plausibly diverge from correct Dijkstra output,
// beyond what the smaller graphs above already cover.
describe('shortestPath — heap correctness on larger/branchier graphs (#259)', () => {
  it('finds the correct shortest distance across a graph with many decoy branches and re-pushed (stale) heap entries', () => {
    // A long, cheap spine (a-b-c-d-e-f, cost 1 each = 6 total) alongside
    // several expensive direct shortcuts from 'a' that a bad "just take the
    // first thing you see" selection could wrongly prefer, plus a second,
    // slightly-more-expensive path into 'd' (via 'x') that must be
    // discovered, relaxed past, and correctly ignored — the exact shape
    // that produces a stale (superseded) heap entry for 'd'.
    const edges = [
      { locationAId: 'a', locationBId: 'b', distance: 1 },
      { locationAId: 'b', locationBId: 'c', distance: 1 },
      { locationAId: 'c', locationBId: 'd', distance: 1 },
      { locationAId: 'd', locationBId: 'e', distance: 1 },
      { locationAId: 'e', locationBId: 'f', distance: 1 },
      { locationAId: 'a', locationBId: 'x', distance: 1 },
      { locationAId: 'x', locationBId: 'd', distance: 10 }, // discovered, then superseded by a-b-c-d (cost 3)
      { locationAId: 'a', locationBId: 'decoy1', distance: 50 },
      { locationAId: 'a', locationBId: 'decoy2', distance: 40 },
      { locationAId: 'decoy2', locationBId: 'f', distance: 40 }, // a much worse route to the same destination
    ]

    const result = shortestPath(edges, 'a', 'f')
    expect(result?.distance).toBe(5) // a-b-c-d-e-f
    expect(result?.path).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])

    // The superseded-via-x path to 'd' must resolve to the cheaper one.
    const toD = shortestPath(edges, 'a', 'd')
    expect(toD?.distance).toBe(3)
    expect(toD?.path).toEqual(['a', 'b', 'c', 'd'])
  })

  it('correctly finds the shortest of three genuinely competing multi-hop routes', () => {
    const edges = [
      // Route 1: a -> p1 -> p2 -> z, total 9
      { locationAId: 'a', locationBId: 'p1', distance: 4 },
      { locationAId: 'p1', locationBId: 'p2', distance: 4 },
      { locationAId: 'p2', locationBId: 'z', distance: 1 },
      // Route 2: a -> q1 -> q2 -> z, total 6 (the real winner)
      { locationAId: 'a', locationBId: 'q1', distance: 2 },
      { locationAId: 'q1', locationBId: 'q2', distance: 2 },
      { locationAId: 'q2', locationBId: 'z', distance: 2 },
      // Route 3: a -> r1 -> z, total 8
      { locationAId: 'a', locationBId: 'r1', distance: 3 },
      { locationAId: 'r1', locationBId: 'z', distance: 5 },
    ]

    const result = shortestPath(edges, 'a', 'z')
    expect(result?.distance).toBe(6)
    expect(result?.path).toEqual(['a', 'q1', 'q2', 'z'])
  })

  it('produces the same distance as a brute-force check on a larger random-ish connected graph', () => {
    // 12-node cycle plus a few chords — enough breadth that a heap
    // sift-up/sift-down bug affecting ordering (but not correctness of
    // *which* node eventually gets popped) would still have to produce the
    // right final distances, since Dijkstra's correctness doesn't depend on
    // tie-breaking, only on always finalizing the true minimum next.
    const nodes = Array.from({ length: 12 }, (_, i) => `n${i}`)
    const edges: { locationAId: string; locationBId: string; distance: number }[] = []
    for (let i = 0; i < nodes.length; i++) {
      edges.push({ locationAId: nodes[i], locationBId: nodes[(i + 1) % nodes.length], distance: (i % 5) + 1 })
    }
    // A few chords across the cycle.
    edges.push({ locationAId: 'n0', locationBId: 'n6', distance: 3 })
    edges.push({ locationAId: 'n2', locationBId: 'n9', distance: 2 })
    edges.push({ locationAId: 'n4', locationBId: 'n11', distance: 1 })

    // Brute-force reference: plain BFS-with-relaxation over all edges
    // repeated |V| times (Bellman-Ford), independent of shortestPath's own
    // heap implementation, as the correctness oracle.
    function bruteForceDistance(from: string, to: string): number {
      const dist = new Map(nodes.map((n) => [n, Infinity]))
      dist.set(from, 0)
      const undirected = edges.flatMap((e) => [e, { locationAId: e.locationBId, locationBId: e.locationAId, distance: e.distance }])
      for (let iter = 0; iter < nodes.length; iter++) {
        for (const e of undirected) {
          const du = dist.get(e.locationAId)!
          if (du + e.distance < dist.get(e.locationBId)!) dist.set(e.locationBId, du + e.distance)
        }
      }
      return dist.get(to)!
    }

    for (const target of ['n3', 'n7', 'n11']) {
      const expected = bruteForceDistance('n0', target)
      const actual = shortestPath(edges, 'n0', target)
      expect(actual?.distance).toBe(expected)
    }
  })
})

describe('nearestLocation (#108)', () => {
  it('returns the closest of several candidates', () => {
    const edges = [
      { locationAId: 'home', locationBId: 'near', distance: 1 },
      { locationAId: 'home', locationBId: 'far', distance: 10 },
    ]
    expect(nearestLocation(edges, 'home', ['near', 'far'])).toEqual({ locationId: 'near', distance: 1 })
  })

  it('returns null when none of the candidates are reachable', () => {
    const edges = [{ locationAId: 'home', locationBId: 'x', distance: 1 }]
    expect(nearestLocation(edges, 'home', ['unreachable'])).toBeNull()
  })

  it('breaks ties by id for determinism', () => {
    const edges = [
      { locationAId: 'home', locationBId: 'b-candidate', distance: 5 },
      { locationAId: 'home', locationBId: 'a-candidate', distance: 5 },
    ]
    expect(nearestLocation(edges, 'home', ['b-candidate', 'a-candidate'])?.locationId).toBe('a-candidate')
  })

  it('ignores unreachable candidates and still returns the reachable one', () => {
    const edges = [{ locationAId: 'home', locationBId: 'reachable', distance: 3 }]
    const result = nearestLocation(edges, 'home', ['unreachable', 'reachable'])
    expect(result?.locationId).toBe('reachable')
  })
})

describe('graphDiameter (#101 v1.1)', () => {
  it('returns 0 for an empty graph', () => {
    expect(graphDiameter([])).toBe(0)
  })

  it('returns the raw distance for a single edge', () => {
    expect(graphDiameter([{ locationAId: 'a', locationBId: 'b', distance: 4 }])).toBe(4)
  })

  it('computes the diameter of a 3-node line as the end-to-end distance, not just one hop', () => {
    const edges = [
      { locationAId: 'a', locationBId: 'b', distance: 1 },
      { locationAId: 'b', locationBId: 'c', distance: 1 },
    ]
    expect(graphDiameter(edges)).toBe(2)
  })

  it('is unaffected by disconnected components — only reachable pairs count', () => {
    const edges = [
      { locationAId: 'a', locationBId: 'b', distance: 1 },
      { locationAId: 'x', locationBId: 'y', distance: 100 },
    ]
    // The disconnected pair (a/b vs x/y) is never reachable, so it can't
    // inflate the diameter — the true max is the largest single component's.
    expect(graphDiameter(edges)).toBe(100)
  })

  it('finds the diameter across a branching graph, not just the first path explored', () => {
    // hub connects to three spokes at varying distances; the diameter is
    // between the two farthest spokes, not hub-to-any-single-spoke.
    const edges = [
      { locationAId: 'hub', locationBId: 'near', distance: 1 },
      { locationAId: 'hub', locationBId: 'mid', distance: 3 },
      { locationAId: 'hub', locationBId: 'far', distance: 5 },
    ]
    // Farthest pair is mid<->far: 3 + 5 = 8, bigger than near<->far (1+5=6).
    expect(graphDiameter(edges)).toBe(8)
  })
})
