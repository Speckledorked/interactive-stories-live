// src/lib/game/__tests__/complex-exchange-resolver.test.ts
// Deterministic conflict resolution for complex exchanges (depth-hardening
// #32 — see README). Conflicting actions on the same target used to be
// flagged and handed to the AI to arbitrate ("prioritize by timing and
// fiction"); they're now ranked by the roll outcome resolution.ts already
// computed.

import { describe, it, expect } from 'vitest'
import { ComplexExchangeResolver, compareActionsByOutcome, rankActionsByOutcome, MicroExchange } from '../complex-exchange-resolver'
import { ActionPriority } from '../exchange-manager'
import type { ActionMechanics } from '../resolution'

function mechanics(outcome: ActionMechanics['outcome'], total: number): Pick<ActionMechanics, 'outcome' | 'total'> {
  return { outcome, total }
}

describe('compareActionsByOutcome', () => {
  it('ranks a strong hit before a weak hit before a miss', () => {
    const m = new Map([
      ['a', mechanics('miss', 5)],
      ['b', mechanics('strongHit', 11)],
      ['c', mechanics('weakHit', 8)],
    ])
    expect(compareActionsByOutcome({ id: 'b' }, { id: 'a' }, m)).toBeLessThan(0)
    expect(compareActionsByOutcome({ id: 'c' }, { id: 'a' }, m)).toBeLessThan(0)
    expect(compareActionsByOutcome({ id: 'b' }, { id: 'c' }, m)).toBeLessThan(0)
  })

  it('breaks ties within the same band by roll total', () => {
    const m = new Map([
      ['a', mechanics('weakHit', 7)],
      ['b', mechanics('weakHit', 9)],
    ])
    expect(compareActionsByOutcome({ id: 'b' }, { id: 'a' }, m)).toBeLessThan(0)
  })

  it('sorts an unrolled action after any rolled action', () => {
    const m = new Map([['a', mechanics('miss', 3)]])
    expect(compareActionsByOutcome({ id: 'a' }, { id: 'b' }, m)).toBeLessThan(0)
    expect(compareActionsByOutcome({ id: 'b' }, { id: 'a' }, m)).toBeGreaterThan(0)
  })

  it('is 0 (stable) when neither action has a roll on record', () => {
    expect(compareActionsByOutcome({ id: 'a' }, { id: 'b' }, new Map())).toBe(0)
  })
})

describe('rankActionsByOutcome', () => {
  it('orders actions best-outcome-first, deterministically', () => {
    const actions = [
      { id: 'a', character: { name: 'Miss Marple' } },
      { id: 'b', character: { name: 'Strong Steve' } },
      { id: 'c', character: { name: 'Weak Wanda' } },
    ]
    const m = new Map([
      ['a', mechanics('miss', 4)],
      ['b', mechanics('strongHit', 12)],
      ['c', mechanics('weakHit', 8)],
    ])
    const ranked = rankActionsByOutcome(actions, m)
    expect(ranked.map(a => a.character?.name)).toEqual(['Strong Steve', 'Weak Wanda', 'Miss Marple'])
  })

  it('does not mutate the input array', () => {
    const actions = [{ id: 'a' }, { id: 'b' }]
    const copy = [...actions]
    rankActionsByOutcome(actions, new Map())
    expect(actions).toEqual(copy)
  })
})

describe('ComplexExchangeResolver.detectConflicts', () => {
  const resolver = new ComplexExchangeResolver('camp1', 'scene1')

  function microExchange(actions: any[]): MicroExchange {
    return { id: 'm1', priority: ActionPriority.IMMEDIATE_COMBAT, actions, description: 'test', sequenceOrder: 0 }
  }

  it('resolves a contradictory attack-vs-negotiate conflict by roll outcome, not a punt', () => {
    const actions = [
      { id: 'attack-1', character: { name: 'Rook' }, actionText: 'attack the guard captain' },
      { id: 'negotiate-1', character: { name: 'Sable' }, actionText: 'negotiate with the guard captain' },
    ]
    const m = new Map([
      ['attack-1', mechanics('strongHit', 11)],
      ['negotiate-1', mechanics('miss', 5)],
    ])
    const conflicts = resolver.detectConflicts(microExchange(actions), m)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].type).toBe('contradictory')
    expect(conflicts[0].resolutionOrder).toEqual(['Rook', 'Sable'])
    expect(conflicts[0].resolution).toContain('Rook')
    expect(conflicts[0].resolution).toContain('strongHit')
    expect(conflicts[0].resolution).not.toMatch(/AI will prioritize/i)
  })

  it('ranks multiple simultaneous attacks on the same target by outcome', () => {
    const actions = [
      { id: 'a1', character: { name: 'Ashen' }, actionText: 'attack the ogre' },
      { id: 'a2', character: { name: 'Bramble' }, actionText: 'attack the ogre' },
    ]
    const m = new Map([
      ['a1', mechanics('weakHit', 8)],
      ['a2', mechanics('strongHit', 10)],
    ])
    const conflicts = resolver.detectConflicts(microExchange(actions), m)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].type).toBe('simultaneous')
    expect(conflicts[0].resolutionOrder).toEqual(['Bramble', 'Ashen'])
  })

  it('still produces a deterministic order with no mechanics available at all', () => {
    const actions = [
      { id: 'attack-1', character: { name: 'Rook' }, actionText: 'attack the guard captain' },
      { id: 'negotiate-1', character: { name: 'Sable' }, actionText: 'negotiate with the guard captain' },
    ]
    const conflicts = resolver.detectConflicts(microExchange(actions))
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].resolutionOrder).toEqual(['Rook', 'Sable'])
    expect(conflicts[0].resolution).toContain('no roll on record')
  })

  it('returns no conflicts for fewer than two actions', () => {
    expect(resolver.detectConflicts(microExchange([{ id: 'a', character: { name: 'Solo' }, actionText: 'attack the ogre' }]))).toEqual([])
  })
})
