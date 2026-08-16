// src/lib/game/__tests__/factionDebtGraph.test.ts
//
// The property that matters most is the fairness one, and it's the last
// test here: netting a cycle must not move value between factions. Every
// edge on the ring sheds the same amount, so each faction's net position
// (what it is owed minus what it owes) is unchanged — only obligations
// that pointed in a circle disappear. If that ever stops holding, netting
// has become a transfer, which is a very different mechanic from the one
// this is meant to be.

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  findDebtCycle,
  netCycle,
  planCycleNetting,
  type DebtEdge,
} from '../factionDebtGraph'

function edge(id: string, creditor: string, debtor: string, amount: number): DebtEdge {
  return { id, creditorFactionId: creditor, debtorFactionId: debtor, amount }
}

/** Net position: owed to this faction, minus what it owes. */
function netPositions(debts: DebtEdge[]): Map<string, number> {
  const positions = new Map<string, number>()
  const add = (id: string, delta: number) => positions.set(id, (positions.get(id) ?? 0) + delta)
  for (const d of debts) {
    add(d.creditorFactionId, d.amount)
    add(d.debtorFactionId, -d.amount)
  }
  return positions
}

describe('findDebtCycle', () => {
  it('finds nothing in a chain that never closes', () => {
    expect(findDebtCycle([edge('1', 'a', 'b', 10), edge('2', 'b', 'c', 5)])).toBeNull()
  })

  it('finds a three-faction ring and nets at its smallest edge', () => {
    const cycle = findDebtCycle([
      edge('1', 'a', 'b', 30),
      edge('2', 'b', 'c', 12),
      edge('3', 'c', 'a', 20),
    ])
    expect(cycle).not.toBeNull()
    expect(cycle!.edges).toHaveLength(3)
    expect(cycle!.nettableAmount).toBe(12)
  })

  it('finds a two-faction ring — the mutual-debt case', () => {
    const cycle = findDebtCycle([edge('1', 'a', 'b', 8), edge('2', 'b', 'a', 3)])
    expect(cycle!.nettableAmount).toBe(3)
  })

  it('ignores a self-loop rather than netting a debt against itself', () => {
    // Unreachable through economyTick's origination path, but a one-edge
    // "cycle" would silently erase a real obligation, so don't trust it.
    expect(findDebtCycle([edge('1', 'a', 'a', 10)])).toBeNull()
  })

  it('ignores edges already at zero', () => {
    expect(findDebtCycle([edge('1', 'a', 'b', 0), edge('2', 'b', 'a', 0)])).toBeNull()
  })

  it('finds a ring reachable only through a non-cyclic prefix', () => {
    // The walk has to get past a->b before the b/c/d ring is visible, and
    // must report only the ring, not the tail that led to it.
    const cycle = findDebtCycle([
      edge('lead', 'a', 'b', 50),
      edge('1', 'b', 'c', 9),
      edge('2', 'c', 'd', 7),
      edge('3', 'd', 'b', 11),
    ])
    expect(cycle!.edges.map((e) => e.id).sort()).toEqual(['1', '2', '3'])
    expect(cycle!.nettableAmount).toBe(7)
  })
})

describe('netCycle', () => {
  it('sheds the ring minimum from every edge and settles exactly the smallest', () => {
    const cycle = findDebtCycle([
      edge('1', 'a', 'b', 30),
      edge('2', 'b', 'c', 12),
      edge('3', 'c', 'a', 20),
    ])!
    const result = netCycle(cycle)
    expect(result.find((r) => r.debtId === '1')).toMatchObject({ newAmount: 18, settled: false })
    expect(result.find((r) => r.debtId === '2')).toMatchObject({ newAmount: 0, settled: true })
    expect(result.find((r) => r.debtId === '3')).toMatchObject({ newAmount: 8, settled: false })
  })

  it('settles every edge when the whole ring is equal', () => {
    const cycle = findDebtCycle([
      edge('1', 'a', 'b', 10),
      edge('2', 'b', 'c', 10),
      edge('3', 'c', 'a', 10),
    ])!
    expect(netCycle(cycle).every((r) => r.settled)).toBe(true)
  })
})

describe('planCycleNetting', () => {
  it('leaves an acyclic graph completely alone', () => {
    expect(planCycleNetting([edge('1', 'a', 'b', 10), edge('2', 'b', 'c', 5)])).toEqual([])
  })

  it('clears independent cycles in one call', () => {
    const plan = planCycleNetting([
      edge('1', 'a', 'b', 5),
      edge('2', 'b', 'a', 5),
      edge('3', 'c', 'd', 7),
      edge('4', 'd', 'c', 7),
    ])
    expect(plan).toHaveLength(4)
    expect(plan.every((p) => p.settled)).toBe(true)
  })

  it('reports one final entry per debt when cycles overlap', () => {
    // Edge '1' sits on both rings. It must report its end state once, not
    // once per cycle with a stale intermediate amount in between.
    const plan = planCycleNetting([
      edge('1', 'a', 'b', 20),
      edge('2', 'b', 'a', 5),
      edge('3', 'b', 'c', 30),
      edge('4', 'c', 'a', 30),
    ])
    const ids = plan.map((p) => p.debtId)
    expect(new Set(ids).size).toBe(ids.length)
    const one = plan.find((p) => p.debtId === '1')!
    expect(one.previousAmount).toBe(20)
  })

  it('terminates on a graph that is one large ring', () => {
    const ring = Array.from({ length: 40 }, (_, i) =>
      edge(`e${i}`, `f${i}`, `f${(i + 1) % 40}`, i + 1)
    )
    const plan = planCycleNetting(ring)
    expect(plan.length).toBeGreaterThan(0)
  })
})

describe('netting never moves value between factions', () => {
  it('preserves every faction’s net position (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            creditor: fc.integer({ min: 0, max: 5 }),
            debtor: fc.integer({ min: 0, max: 5 }),
            amount: fc.integer({ min: 1, max: 100 }),
          }),
          { minLength: 0, maxLength: 25 }
        ),
        (raw) => {
          const debts: DebtEdge[] = raw
            .map((r, i) => edge(`d${i}`, `f${r.creditor}`, `f${r.debtor}`, r.amount))
            .filter((d) => d.creditorFactionId !== d.debtorFactionId)

          const before = netPositions(debts)
          const plan = planCycleNetting(debts)
          const planById = new Map(plan.map((p) => [p.debtId, p]))

          const after = netPositions(
            debts.map((d) => ({ ...d, amount: planById.get(d.id)?.newAmount ?? d.amount }))
          )

          for (const faction of new Set([...before.keys(), ...after.keys()])) {
            expect(after.get(faction) ?? 0).toBe(before.get(faction) ?? 0)
          }

          // And netting only ever reduces obligations — never invents them.
          for (const p of plan) {
            expect(p.newAmount).toBeLessThan(p.previousAmount)
            expect(p.newAmount).toBeGreaterThanOrEqual(0)
          }
        }
      ),
      { numRuns: 300 }
    )
  })
})
