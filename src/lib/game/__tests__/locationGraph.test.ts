// src/lib/game/__tests__/locationGraph.test.ts
//
// #445 (F-04): a location minted after campaign creation joins the graph.
//
// #379's own module comment names the shape of this bug precisely — "a
// graph-backed feature whose graph is populated by exactly one optional
// pipeline, with a defensive fallback that makes total absence
// indistinguishable from a sparse graph" — and then #379's fix had it too:
// three writers, all at creation time, none at runtime. A place the AI mints
// mid-scene had zero edges, and all five graph readers fall back silently,
// so it existed for the players and not for the simulation.
//
// The tests that matter here are the ones about NOT rewriting an authored
// map, because the obvious fix (re-run buildDefaultAdjacency over the bigger
// set) would do exactly that.

import { describe, it, expect, vi } from 'vitest'
import { edgesForNewLocation, attachLocationToGraph } from '../locationGraph'
import { buildDefaultAdjacency } from '../defaultAdjacency'

describe('edgesForNewLocation (#445)', () => {
  it('gives the first location in a campaign no edges', () => {
    // A correct answer, not a degenerate one — there is nothing to connect
    // to. The second location's insertion creates the first edge.
    expect(edgesForNewLocation([], 'a')).toEqual([])
  })

  it('connects the second location to the first', () => {
    expect(edgesForNewLocation(['a'], 'b')).toEqual([
      { locationAId: 'a', locationBId: 'b', distance: 1 },
    ])
  })

  it('only ever returns edges touching the new location', () => {
    // The property that protects an authored map. Re-running
    // buildDefaultAdjacency over the enlarged set would invent edges between
    // locations imported lore had deliberately left unconnected.
    const existing = ['a', 'b', 'c', 'd', 'e', 'f']
    const edges = edgesForNewLocation(existing, 'zz')
    expect(edges.length).toBeGreaterThan(0)
    for (const e of edges) {
      expect(e.locationAId === 'zz' || e.locationBId === 'zz').toBe(true)
    }
  })

  it('canonicalizes each edge so skipDuplicates actually deduplicates', () => {
    // LocationAdjacency's @@unique is on the ordered pair, so an edge written
    // the other way round is a second row for the same connection.
    for (const e of edgesForNewLocation(['b', 'c', 'd', 'e', 'f'], 'a')) {
      expect(e.locationAId < e.locationBId).toBe(true)
    }
  })

  it('gives ring neighbours distance 1 and chords distance 2', () => {
    const edges = edgesForNewLocation(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'd0')
    const distances = new Set(edges.map((e) => e.distance))
    expect(distances.has(1)).toBe(true)
    expect(distances.has(2)).toBe(true)
  })

  it('adds no chords in a world too small for a chord to shorten anything', () => {
    // buildDefaultAdjacency's own rule (CHORD_STRIDE + 1), matched here so
    // an incrementally-grown graph looks like a batch-built one.
    const edges = edgesForNewLocation(['a', 'b'], 'c')
    expect(edges.every((e) => e.distance === 1)).toBe(true)
  })

  it('is deterministic — the same insertion twice gives the same edges', () => {
    const a = edgesForNewLocation(['a', 'b', 'c', 'd', 'e'], 'x')
    const b = edgesForNewLocation(['e', 'd', 'c', 'b', 'a'], 'x')
    expect(a).toEqual(b)
  })

  it('ignores the new id appearing in the existing list', () => {
    // The AI-creation path reads locations back AFTER the insert, so the new
    // row is already there. Self-edges would violate the unique index.
    const withSelf = edgesForNewLocation(['a', 'b', 'c', 'd', 'x'], 'x')
    const without = edgesForNewLocation(['a', 'b', 'c', 'd'], 'x')
    expect(withSelf).toEqual(without)
    expect(withSelf.every((e) => e.locationAId !== e.locationBId)).toBe(true)
  })

  it('leaves no location unreachable when a graph is grown one at a time', () => {
    // The actual claim: growing incrementally must not produce an island,
    // because an island is exactly what all five readers treat as "no graph".
    const ids: string[] = []
    const edges: Array<{ locationAId: string; locationBId: string }> = []
    for (let i = 0; i < 12; i++) {
      const id = `loc-${String(i).padStart(2, '0')}`
      edges.push(...edgesForNewLocation(ids, id))
      ids.push(id)
    }

    const adjacency = new Map<string, string[]>(ids.map((id) => [id, []]))
    for (const e of edges) {
      adjacency.get(e.locationAId)!.push(e.locationBId)
      adjacency.get(e.locationBId)!.push(e.locationAId)
    }
    const seen = new Set<string>([ids[0]])
    const queue = [ids[0]]
    while (queue.length) {
      for (const next of adjacency.get(queue.shift()!)!) {
        if (!seen.has(next)) { seen.add(next); queue.push(next) }
      }
    }
    expect(seen.size).toBe(ids.length)
  })

  it('produces the same ring the batch builder would, for a graph grown from nothing', () => {
    // Not a strict subset claim in either direction — incremental insertion
    // keeps edges a later batch rebuild would not draw. What must hold is
    // that every RING edge of the batch graph is present, so hop distances
    // stay in the range informationTick's latency tiers were tuned against.
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const grown = new Set<string>()
    const soFar: string[] = []
    for (const id of ids) {
      for (const e of edgesForNewLocation(soFar, id)) grown.add(`${e.locationAId}|${e.locationBId}`)
      soFar.push(id)
    }
    for (const e of buildDefaultAdjacency(ids).filter((e) => e.distance === 1)) {
      expect(grown.has(`${e.locationAId}|${e.locationBId}`)).toBe(true)
    }
  })
})

describe('attachLocationToGraph (#445)', () => {
  function db(ids: string[]) {
    return {
      location: { findMany: vi.fn(async () => ids.map((id) => ({ id }))) },
      locationAdjacency: { createMany: vi.fn(async (_args: any) => ({ count: 2 })) },
    }
  }

  it('writes the new location\'s edges scoped to its campaign', async () => {
    const d = db(['a', 'b', 'c', 'new'])
    await attachLocationToGraph(d, 'camp1', 'new')

    const args = d.locationAdjacency.createMany.mock.calls[0]![0] as any
    expect(args.skipDuplicates).toBe(true)
    for (const row of args.data) expect(row.campaignId).toBe('camp1')
  })

  it('writes nothing at all for a campaign\'s first location', async () => {
    const d = db(['only'])
    await attachLocationToGraph(d, 'camp1', 'only')
    expect(d.locationAdjacency.createMany).not.toHaveBeenCalled()
  })

  it('never throws — a missing edge must not lose the location', async () => {
    // Every call site has already committed the Location row. Failing here
    // degrades to precisely the behaviour that existed before this function;
    // throwing would roll back a place the AI just narrated into existence.
    const d = db(['a', 'b', 'new'])
    d.locationAdjacency.createMany.mockRejectedValueOnce(new Error('db down'))
    await expect(attachLocationToGraph(d, 'camp1', 'new')).resolves.toBe(0)
  })

  it('is idempotent on a replay', async () => {
    const d = db(['a', 'b', 'c', 'new'])
    d.locationAdjacency.createMany.mockResolvedValue({ count: 0 })
    expect(await attachLocationToGraph(d, 'camp1', 'new')).toBe(0)
  })
})
