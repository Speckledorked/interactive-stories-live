// src/lib/game/factionDebtGraph.ts
//
// FactionDebt read as a directed graph (#371).
//
// The rows were always edges — `creditorFactionId -> debtorFactionId` with
// a weight, both endpoints indexed — but nothing ever traversed them. Each
// debt was only ever examined on its own, which means the one thing a debt
// network does that a list of debts cannot was invisible: **cycles**.
//
// Why that matters more here than it would elsewhere: until now a
// FactionDebt had exactly one exit, and it was catastrophic. The status
// enum declares OUTSTANDING | DEFAULTED | PAID, and nothing in the
// codebase has ever written PAID — a debt sat there until its debtor went
// broke or collapsed, then defaulted and put a stability shockwave through
// its creditor (economyTick's cascade). Obligations could only ever
// accumulate.
//
// A cycle is the case where that's plainly wrong. If A owes B, B owes C,
// and C owes A, then some of what each of them "owes" is owed straight
// back around the ring. Cancelling the common minimum settles real
// obligations for everyone at once and costs nobody anything — it is the
// one debt resolution that requires no resources to change hands, which
// is exactly why a broke faction can benefit from it. It's also the first
// path by which a debt can reach PAID.
//
// Deliberately pure and side-effect free, the same shape worldGraph.ts
// uses: the caller hands in rows it has already scoped and filtered, and
// gets back a decision. No queries, no writes, no clock. The tick stays
// deterministic and zero-AI.

/** One outstanding obligation. `amount` is in the faction resource scale
 * economyTick already uses, not gold. */
export interface DebtEdge {
  id: string
  creditorFactionId: string
  debtorFactionId: string
  amount: number
}

/** A ring of obligations that returns to where it started, plus the
 * amount that can be cancelled all the way around it. */
export interface DebtCycle {
  /** Edges in traversal order. `debtorFactionId` of each is the
   * `creditorFactionId` of the next; the last closes back to the first. */
  edges: DebtEdge[]
  /** The smallest amount on the ring — what every edge can shed. */
  nettableAmount: number
}

/** What netting a cycle does to one edge. */
export interface DebtNetting {
  debtId: string
  previousAmount: number
  newAmount: number
  /** True when the edge nets to nothing and is fully settled. Exactly one
   * edge is always fully settled per cycle (the minimum one); more than
   * one only when several tie at the minimum. */
  settled: boolean
}

/**
 * Find one cycle among these debts, or null.
 *
 * Iterative depth-first search over the creditor→debtor direction, with an
 * explicit stack rather than recursion: a campaign's debt graph is small,
 * but a tick handler should not be the thing that discovers the engine's
 * stack limit.
 *
 * Returns a single cycle rather than all of them, on purpose. Netting one
 * cycle rewrites the amounts the next search would read, so enumerating
 * everything up front would hand back decisions that are already stale by
 * the time the second is applied. The caller nets one, then asks again —
 * see `planCycleNetting`.
 *
 * Self-loops (a faction owing itself) can't occur through economyTick's
 * origination path, but are skipped rather than trusted: a one-edge
 * "cycle" would net a debt against itself and silently erase it.
 */
export function findDebtCycle(debts: DebtEdge[]): DebtCycle | null {
  const outgoing = new Map<string, DebtEdge[]>()
  for (const debt of debts) {
    if (debt.creditorFactionId === debt.debtorFactionId) continue
    if (debt.amount <= 0) continue
    const list = outgoing.get(debt.creditorFactionId)
    if (list) list.push(debt)
    else outgoing.set(debt.creditorFactionId, [debt])
  }

  // 'visiting' = on the current path (a hit here is a real cycle);
  // 'done' = fully explored and known not to start one.
  const visiting = new Set<string>()
  const done = new Set<string>()
  // The edges that got us to each node on the current path.
  const pathEdges: DebtEdge[] = []

  for (const start of outgoing.keys()) {
    if (done.has(start)) continue

    // Each frame holds a node and how far through its edges we are, so
    // the walk can be unwound without recursion.
    const stack: Array<{ node: string; edgeIndex: number }> = [{ node: start, edgeIndex: 0 }]
    visiting.add(start)

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const edges = outgoing.get(frame.node) ?? []

      if (frame.edgeIndex >= edges.length) {
        visiting.delete(frame.node)
        done.add(frame.node)
        stack.pop()
        pathEdges.pop()
        continue
      }

      const edge = edges[frame.edgeIndex++]
      const next = edge.debtorFactionId

      if (visiting.has(next)) {
        // Closed the ring. The cycle is the tail of the current path from
        // wherever `next` first appears, plus the edge that closed it.
        pathEdges.push(edge)
        const startIndex = pathEdges.findIndex((e) => e.creditorFactionId === next)
        const cycleEdges = pathEdges.slice(startIndex)
        return {
          edges: cycleEdges,
          nettableAmount: Math.min(...cycleEdges.map((e) => e.amount)),
        }
      }

      if (done.has(next)) continue

      visiting.add(next)
      pathEdges.push(edge)
      stack.push({ node: next, edgeIndex: 0 })
    }

    pathEdges.length = 0
  }

  return null
}

/**
 * Reduce every edge on a cycle by the ring's minimum.
 *
 * Pure arithmetic — the caller persists it. Every edge sheds the same
 * amount, so no faction is made better or worse off relative to any
 * other; what disappears is only the portion that was owed in a circle.
 */
export function netCycle(cycle: DebtCycle): DebtNetting[] {
  return cycle.edges.map((edge) => {
    const newAmount = edge.amount - cycle.nettableAmount
    return {
      debtId: edge.id,
      previousAmount: edge.amount,
      newAmount,
      settled: newAmount <= 0,
    }
  })
}

/**
 * Net every cycle in the graph, repeatedly, until none is left.
 *
 * Each pass removes at least one edge from circulation (the minimum one
 * settles to zero), so the loop is bounded by the edge count and cannot
 * spin. `maxRounds` is belt-and-braces against a future change to the
 * search making that less obviously true, not a limit anyone should hit.
 *
 * Returns one entry per debt that changed, already collapsed so a debt
 * touched by two different cycles reports its final amount once rather
 * than appearing twice with intermediate values.
 */
export function planCycleNetting(debts: DebtEdge[], maxRounds = 64): DebtNetting[] {
  const currentAmount = new Map(debts.map((d) => [d.id, d.amount]))
  const originalAmount = new Map(debts.map((d) => [d.id, d.amount]))
  const touched = new Set<string>()

  for (let round = 0; round < maxRounds; round++) {
    const live: DebtEdge[] = debts
      .map((d) => ({ ...d, amount: currentAmount.get(d.id) ?? 0 }))
      .filter((d) => d.amount > 0)

    const cycle = findDebtCycle(live)
    if (!cycle || cycle.nettableAmount <= 0) break

    for (const netting of netCycle(cycle)) {
      currentAmount.set(netting.debtId, netting.newAmount)
      touched.add(netting.debtId)
    }
  }

  return [...touched].map((debtId) => {
    const previousAmount = originalAmount.get(debtId) ?? 0
    const newAmount = currentAmount.get(debtId) ?? 0
    return { debtId, previousAmount, newAmount, settled: newAmount <= 0 }
  })
}
