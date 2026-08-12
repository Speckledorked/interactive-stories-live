// src/lib/game/__tests__/conditionGates.test.ts
//
// Location condition as a real content gate (#206).
//
// Mirrors corruptionGates.test.ts's shape: the gating arithmetic itself is
// simple (it's a thin wrapper over deriveConditionTags), what matters is
// that only the two most severe bands actually block, that an entity with
// no condition data always passes, and that the refusal phrasing carries
// no numbers. The boundary-only rule (entry, acquisition — never
// retroactive) lives at the call sites and is covered where those are
// tested (characters.test.ts, quests.test.ts).

import { describe, it, expect } from 'vitest'
import { checkConditionGate, describeConditionRefusal } from '../conditionGates'

describe('checkConditionGate', () => {
  it('blocks an ABANDONED location (conditionScore <= 0)', () => {
    expect(checkConditionGate({ conditionScore: 0, isContested: false }))
      .toEqual({ allowed: false, refusal: 'abandoned' })
  })

  it('blocks a RUINED location (conditionScore < 25)', () => {
    expect(checkConditionGate({ conditionScore: 10, isContested: false }))
      .toEqual({ allowed: false, refusal: 'ruined' })
    expect(checkConditionGate({ conditionScore: 24, isContested: false }).allowed).toBe(false)
  })

  it('allows a DAMAGED location — worth a roll penalty, not worth turning anyone away', () => {
    expect(checkConditionGate({ conditionScore: 25, isContested: false }).allowed).toBe(true)
    expect(checkConditionGate({ conditionScore: 49, isContested: false }).allowed).toBe(true)
  })

  it('allows STABLE and PROSPEROUS locations', () => {
    expect(checkConditionGate({ conditionScore: 50, isContested: false }).allowed).toBe(true)
    expect(checkConditionGate({ conditionScore: 100, isContested: false }).allowed).toBe(true)
  })

  it('blocks regardless of isContested — CONTESTED is an overlay, not an escape hatch', () => {
    expect(checkConditionGate({ conditionScore: 10, isContested: true }))
      .toEqual({ allowed: false, refusal: 'ruined' })
  })

  it('handles a missing entity without throwing', () => {
    expect(checkConditionGate(null).allowed).toBe(true)
    expect(checkConditionGate(undefined).allowed).toBe(true)
  })
})

describe('describeConditionRefusal', () => {
  it('never mentions numbers, and the two refusals read differently', () => {
    const ruined = describeConditionRefusal('ruined')
    const abandoned = describeConditionRefusal('abandoned')
    for (const line of [ruined, abandoned]) {
      expect(line).not.toMatch(/\d/)
    }
    expect(ruined).not.toBe(abandoned)
  })
})
