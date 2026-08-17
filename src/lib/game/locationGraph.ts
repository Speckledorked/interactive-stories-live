// src/lib/game/locationGraph.ts
// #445 (F-04): a location minted after campaign creation joins the graph.
//
// #379 gave every campaign a world graph, and #379's own module comment is
// the diagnosis of what was still missing: LocationAdjacency had exactly one
// writer. It now has three — the template seeder, the lore reseed, and the
// backfill migration — and all three are CREATION-TIME. Nothing wrote an
// edge at runtime.
//
// So a location the AI mints mid-scene (worldUpdaters/locations.ts) or an
// admin hand-authors got resource slots and zero edges. Every one of the
// five graph readers — informationTick, npcTick, migrationTick,
// logisticsTick, ambitionResolution — treats an unreachable node exactly the
// way it treats a campaign with no graph at all: it falls back silently. The
// place exists, the party can walk there, and news from it never arrives.
//
// The backfill cannot repair this either: it only touches campaigns with NO
// edges, so a campaign that got a graph on day one and a new location on day
// forty stays permanently broken.
//
// ## Why this inserts locally instead of rebuilding
//
// buildDefaultAdjacency computes a whole ring at once. Re-running it over
// the enlarged set would work for a default graph and would VANDALISE an
// authored one — imported lore produces a real map, and #379 was careful
// never to overwrite it (the backfill's `WHERE NOT EXISTS` clause exists for
// exactly that). So this returns only edges INCIDENT TO THE NEW NODE,
// following the same ring-plus-chord rule restricted to that node. An
// authored map keeps every edge it had and gains a reachable new place;
// a default map stays exactly the ring it would have been.

export interface AdjacencyEdgeInput {
  locationAId: string
  locationBId: string
  distance: number
}

/** Same canonicalization buildDefaultAdjacency uses — smaller id first, which
 * is what LocationAdjacency's @@unique documents and what makes
 * skipDuplicates actually deduplicate. */
function edge(a: string, b: string, distance: number): AdjacencyEdgeInput {
  const [locationAId, locationBId] = a < b ? [a, b] : [b, a]
  return { locationAId, locationBId, distance }
}

/**
 * The edges connecting `newLocationId` into a campaign's existing locations.
 *
 * Pure and deterministic — the id-sorted position decides the neighbours, so
 * the same insertion produces the same edges on a retry, and
 * `skipDuplicates` turns a replay into a no-op.
 *
 * Mirrors buildDefaultAdjacency's shape: ring neighbours at distance 1, a
 * chord at stride 3 and distance 2 once the world is big enough for a chord
 * to shorten anything. Never returns an edge between two EXISTING locations,
 * so an authored graph is only ever extended, never rewritten.
 */
export function edgesForNewLocation(
  existingLocationIds: string[],
  newLocationId: string
): AdjacencyEdgeInput[] {
  const ids = Array.from(new Set(existingLocationIds)).filter((id) => id !== newLocationId)
  // The first location in a campaign has nothing to connect to. That is a
  // correct answer, not a degenerate one — the second location's insertion
  // creates the first edge.
  if (ids.length === 0) return []

  const all = [...ids, newLocationId].sort()
  const i = all.indexOf(newLocationId)
  const n = all.length

  const edges = new Map<string, AdjacencyEdgeInput>()
  const add = (other: string, distance: number) => {
    if (other === newLocationId) return
    const e = edge(newLocationId, other, distance)
    const key = `${e.locationAId}|${e.locationBId}`
    // First writer wins, so a ring edge is never downgraded to a chord in a
    // small world where the two coincide — buildDefaultAdjacency's rule.
    if (!edges.has(key)) edges.set(key, e)
  }

  add(all[(i + 1) % n], 1)
  add(all[(i - 1 + n) % n], 1)

  const CHORD_STRIDE = 3
  if (n > CHORD_STRIDE + 1) {
    add(all[(i + CHORD_STRIDE) % n], 2)
    add(all[(i - CHORD_STRIDE + n) % n], 2)
  }

  return [...edges.values()]
}

/** Just enough of the Prisma client for this to run inside or outside a
 * transaction — every runtime location creator is in one of the two. */
interface GraphDb {
  location: { findMany(args: any): Promise<Array<{ id: string }>> }
  locationAdjacency: { createMany(args: any): Promise<{ count: number }> }
}

/**
 * Connect a just-created location into its campaign's graph.
 *
 * Best-effort by design: the location itself is already committed by the
 * time this runs at every call site, and an adjacency failure must not undo
 * a real location the AI just narrated into existence. A missing edge
 * degrades to exactly the behaviour that existed before this function — the
 * five readers' silent fallback — rather than losing the place.
 *
 * Returns how many edges were actually written (0 on a replay, since
 * skipDuplicates makes this idempotent).
 */
export async function attachLocationToGraph(
  db: GraphDb,
  campaignId: string,
  newLocationId: string
): Promise<number> {
  try {
    const locations = await db.location.findMany({
      where: { campaignId },
      select: { id: true },
    })
    const edges = edgesForNewLocation(locations.map((l) => l.id), newLocationId)
    if (edges.length === 0) return 0

    const created = await db.locationAdjacency.createMany({
      data: edges.map((e) => ({ campaignId, ...e })),
      skipDuplicates: true,
    })
    return created.count
  } catch (error) {
    console.error('⚠️ Failed to attach location to the world graph (non-critical):', error)
    return 0
  }
}
