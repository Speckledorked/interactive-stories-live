// src/lib/game/__tests__/tieGraph.test.ts
// #373: the social graph as a graph. The projection half has to reproduce
// exactly what the old per-node JSON blobs gave every reader; the traversal
// half is the capability that did not exist before.

import { describe, it, expect } from 'vitest'
import {
  canonicalPair,
  canonicalTie,
  pairKey,
  indexTies,
  tiesOf,
  factionTies,
  npcTies,
  edgesFromFactionRows,
  edgesFromNpcRows,
  socialDistancesFrom,
  type TieEdge,
} from '../tieGraph'

const edge = (a: string, b: string, type: 'RIVAL' | 'ALLY' = 'ALLY', since = 1): TieEdge => ({
  aId: a, bId: b, type, since,
})

describe('canonicalPair', () => {
  it('orders the endpoints the same way regardless of argument order', () => {
    expect(canonicalPair('b', 'a')).toEqual({ aId: 'a', bId: 'b' })
    expect(canonicalPair('a', 'b')).toEqual({ aId: 'a', bId: 'b' })
  })

  it('rejects a self-pair rather than producing a row the DB would refuse', () => {
    // The CHECK constraint is `aId < bId`, so a self-edge is not merely
    // meaningless — it is unwritable. Returning null lets the caller drop
    // it quietly instead of discovering it as a failed transaction.
    expect(canonicalPair('a', 'a')).toBeNull()
    expect(canonicalTie('a', 'a', 'ALLY', 3)).toBeNull()
  })

  it('carries type and since onto the canonical edge', () => {
    expect(canonicalTie('b', 'a', 'RIVAL', 7)).toEqual({ aId: 'a', bId: 'b', type: 'RIVAL', since: 7 })
  })
})

describe('pairKey', () => {
  it('is order-independent', () => {
    expect(pairKey('x', 'y')).toBe(pairKey('y', 'x'))
    expect(pairKey('x', 'y')).not.toBe(pairKey('x', 'z'))
  })
})

describe('indexTies', () => {
  it('makes one edge visible from BOTH endpoints', () => {
    // This is the property that replaced writing each tie twice. Under the
    // JSON blobs the two directions were separate stored facts that could
    // disagree; here they are one row read from two sides, so they cannot.
    const index = indexTies([edge('a', 'b', 'RIVAL', 4)])
    expect(tiesOf(index, 'a')).toEqual({ b: { type: 'RIVAL', since: 4 } })
    expect(tiesOf(index, 'b')).toEqual({ a: { type: 'RIVAL', since: 4 } })
  })

  it('collects several ties per entity', () => {
    const index = indexTies([edge('a', 'b', 'ALLY', 1), edge('a', 'c', 'RIVAL', 2)])
    expect(tiesOf(index, 'a')).toEqual({
      b: { type: 'ALLY', since: 1 },
      c: { type: 'RIVAL', since: 2 },
    })
  })

  it('reads an entity with no edges as no ties, not undefined', () => {
    expect(tiesOf(indexTies([]), 'nobody')).toEqual({})
  })
})

describe('factionTies / npcTies', () => {
  it('projects the two Prisma relation arrays into one neighbour map', () => {
    const faction = {
      id: 'f2',
      tiesAsA: [{ factionAId: 'f2', factionBId: 'f9', type: 'ALLY' as const, since: 3 }],
      tiesAsB: [{ factionAId: 'f1', factionBId: 'f2', type: 'RIVAL' as const, since: 5 }],
    }
    expect(factionTies(faction)).toEqual({
      f9: { type: 'ALLY', since: 3 },
      f1: { type: 'RIVAL', since: 5 },
    })
  })

  it('tolerates a caller that selected neither side', () => {
    // A fixture or a partial select reads as "no ties" rather than throwing
    // — the same behaviour a null JSON column used to have.
    expect(factionTies({ id: 'f1' })).toEqual({})
    expect(npcTies({ id: 'n1' })).toEqual({})
  })

  it('projects NPC rows the same way', () => {
    const npc = {
      id: 'n2',
      tiesAsA: [{ npcAId: 'n2', npcBId: 'n5', type: 'RIVAL' as const, since: 2 }],
      tiesAsB: [],
    }
    expect(npcTies(npc)).toEqual({ n5: { type: 'RIVAL', since: 2 } })
  })

  it('converts row shapes to edges', () => {
    expect(edgesFromFactionRows([{ factionAId: 'a', factionBId: 'b', type: 'ALLY', since: 1 }]))
      .toEqual([{ aId: 'a', bId: 'b', type: 'ALLY', since: 1 }])
    expect(edgesFromNpcRows([{ npcAId: 'a', npcBId: 'b', type: 'RIVAL', since: 0 }]))
      .toEqual([{ aId: 'a', bId: 'b', type: 'RIVAL', since: 0 }])
  })
})

describe('socialDistancesFrom (#373 — the traversal that was impossible before)', () => {
  //   a — b — c — d      (all ALLY)
  //   a — x              (RIVAL)
  const chain = [
    edge('a', 'b'),
    edge('b', 'c'),
    edge('c', 'd'),
    edge('a', 'x', 'RIVAL'),
  ]

  it('counts hops from the source', () => {
    const d = socialDistancesFrom(chain, ['a'])
    expect(d.get('a')).toBe(0)
    expect(d.get('b')).toBe(1)
    expect(d.get('c')).toBe(2)
    expect(d.get('d')).toBe(3)
  })

  it('does not route through a rivalry', () => {
    // Treating a rivalry as a channel would say the one person you refuse
    // to speak to is how you find things out.
    expect(socialDistancesFrom(chain, ['a']).has('x')).toBe(false)
  })

  it('routes through rivalries when asked to', () => {
    const d = socialDistancesFrom(chain, ['a'], { through: ['ALLY', 'RIVAL'] })
    expect(d.get('x')).toBe(1)
  })

  it('takes the nearest of several sources', () => {
    const d = socialDistancesFrom(chain, ['a', 'd'])
    expect(d.get('a')).toBe(0)
    expect(d.get('d')).toBe(0)
    expect(d.get('c')).toBe(1) // one hop from d, three from a
  })

  it('omits an unreachable entity rather than reporting distance zero', () => {
    // The difference matters: a caller reading a missing entry as 0 would
    // give someone with no social path to the event the FASTEST delay.
    const d = socialDistancesFrom([edge('a', 'b')], ['a'])
    expect(d.has('island')).toBe(false)
  })

  it('returns nothing but the sources when there are no edges', () => {
    expect([...socialDistancesFrom([], ['a']).entries()]).toEqual([['a', 0]])
  })

  it('does not loop forever on a cycle', () => {
    // Unlike the capability graph (#372), the social graph has no acyclicity
    // invariant at all — mutual alliances are cycles by construction.
    const cycle = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]
    const d = socialDistancesFrom(cycle, ['a'])
    expect(d.get('b')).toBe(1)
    expect(d.get('c')).toBe(1)
  })
})
