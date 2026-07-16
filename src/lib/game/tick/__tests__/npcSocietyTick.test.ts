// src/lib/game/tick/__tests__/npcSocietyTick.test.ts
// Phase 9 NPC society: pure decision functions for individual-level ties
// and joint schemes, derived from faction-level politics.

import { describe, it, expect } from 'vitest'
import { decideNpcSocialTie, decideJointScheme } from '../npcSocietyTick'
import { isActingPhase } from '../npcTick'

describe('decideNpcSocialTie', () => {
  it('makes colleagues in the same faction allies, regardless of faction-level relationship', () => {
    expect(decideNpcSocialTie({ factionId: 'f1' }, { factionId: 'f1' }, 'NEUTRAL')).toBe('ALLY')
    expect(decideNpcSocialTie({ factionId: 'f1' }, { factionId: 'f1' }, 'RIVAL')).toBe('ALLY')
  })

  it('inherits the tie from differing factions\' relationship', () => {
    expect(decideNpcSocialTie({ factionId: 'f1' }, { factionId: 'f2' }, 'RIVAL')).toBe('RIVAL')
    expect(decideNpcSocialTie({ factionId: 'f1' }, { factionId: 'f2' }, 'ALLY')).toBe('ALLY')
    expect(decideNpcSocialTie({ factionId: 'f1' }, { factionId: 'f2' }, 'NEUTRAL')).toBe('NEUTRAL')
  })

  it('is NEUTRAL when either NPC has no faction affiliation', () => {
    expect(decideNpcSocialTie({ factionId: null }, { factionId: 'f2' }, 'RIVAL')).toBe('NEUTRAL')
    expect(decideNpcSocialTie({ factionId: 'f1' }, { factionId: null }, 'ALLY')).toBe('NEUTRAL')
    expect(decideNpcSocialTie({ factionId: null }, { factionId: null }, 'NEUTRAL')).toBe('NEUTRAL')
  })
})

describe('decideJointScheme', () => {
  // isActingPhase is a stable hash of the npc id, not random — find a real
  // turn where both test NPCs land on "acting" simultaneously, the same
  // way the tick handler discovers convergence.
  function findConvergentTurn(idA: string, idB: string): number {
    for (let t = 0; t < 200; t++) {
      if (isActingPhase(idA, t) && isActingPhase(idB, t)) return t
    }
    throw new Error('no convergent turn found in range — pick different test ids')
  }

  const a = { id: 'npc-a', name: 'Lord Kessler', goals: 'secure the harbor trade' }
  const b = { id: 'npc-b', name: 'Captain Vane', goals: 'protect the docks' }

  it('spawns a scheme when both allies converge on the acting phase', () => {
    const turn = findConvergentTurn(a.id, b.id)
    const decision = decideJointScheme(a, b, turn, false)
    expect(decision.shouldSpawn).toBe(true)
    expect(decision.name).toContain('Lord Kessler')
    expect(decision.name).toContain('Captain Vane')
    expect(decision.description).toContain('secure the harbor trade')
    expect(decision.description).toContain('protect the docks')
    expect(decision.maxTicks).toBeGreaterThan(0)
  })

  it('never spawns a second scheme while one is already active', () => {
    const turn = findConvergentTurn(a.id, b.id)
    expect(decideJointScheme(a, b, turn, true).shouldSpawn).toBe(false)
  })

  it('does not spawn outside a convergent acting-phase turn', () => {
    // Turn 0: tempo-derived phase index is 0 ("observing") for any npc id.
    expect(isActingPhase(a.id, 0)).toBe(false)
    expect(decideJointScheme(a, b, 0, false).shouldSpawn).toBe(false)
  })

  it('falls back to generic phrasing for goalless NPCs', () => {
    const turn = findConvergentTurn(a.id, b.id)
    const goalless = { ...a, goals: null }
    const decision = decideJointScheme(goalless, b, turn, false)
    expect(decision.description).toContain('their own ends')
  })
})
