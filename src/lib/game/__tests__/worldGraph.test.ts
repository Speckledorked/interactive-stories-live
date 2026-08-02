import { describe, it, expect } from 'vitest'
import { shortestPath, nearestLocation, directNeighborsOf } from '../worldGraph'

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
