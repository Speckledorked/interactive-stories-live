// src/lib/game/tick/__tests__/goalCommitment.test.ts
//
// A faction that remembers what it was just doing (#79).
//
// Goal reassessment was a pure function of the current stat bands, with no
// notion of what the faction decided last turn — and the arithmetic turned
// that into a permanent oscillation rather than a rare edge case:
//
//   DESTABILIZE_RIVAL drains 2 resources a turn. Dip under the LOW cutoff
//   (34) and the faction switches to ENRICH, which earns 4 and lifts it
//   straight back over — immediately re-qualifying DESTABILIZE_RIVAL. A
//   three-turn cycle, forever.
//
// The faction abandons its scheme against its rival every third turn to go
// make money, resumes it, and never accumulates enough to actually do
// anything. The last case in this file is the one that matters: it runs the
// simulation and fails if the cycle comes back.

import { describe, it, expect } from 'vitest'
import {
  decideFactionGoalReassessment,
  decideFactionTick,
  GOAL_COMMITMENT_TURNS,
} from '../factionTick'

const faction = (over: Record<string, unknown> = {}) => ({
  resources: 50,
  stability: 80,
  military: 90,
  goal: 'DESTABILIZE_RIVAL' as const,
  hasRival: true,
  ...over,
}) as Parameters<typeof decideFactionGoalReassessment>[0]

describe('decideFactionGoalReassessment — commitment', () => {
  it('holds the current goal while it is still freshly adopted', () => {
    // resources 20 would otherwise force ENRICH.
    const g = decideFactionGoalReassessment(faction({ resources: 20, turnsOnCurrentGoal: 0 }))
    expect(g).toBe('DESTABILIZE_RIVAL')
  })

  it('reconsiders once the goal has had a fair run', () => {
    const g = decideFactionGoalReassessment(faction({ resources: 20, turnsOnCurrentGoal: GOAL_COMMITMENT_TURNS }))
    expect(g).toBe('ENRICH')
  })

  it('lets a collapse in stability override commitment immediately', () => {
    // A faction coming apart does not stay the course out of consistency.
    // Crisis is checked before commitment on purpose.
    const g = decideFactionGoalReassessment(faction({ stability: 5, turnsOnCurrentGoal: 0 }))
    expect(g).toBe('DEFEND')
  })

  it('behaves exactly as before when no history is available', () => {
    // What makes the parameter safe to add, and what the fail-soft read
    // path in tickFactions falls back to.
    expect(decideFactionGoalReassessment(faction({ resources: 20 }))).toBe('ENRICH')
    expect(decideFactionGoalReassessment(faction({ resources: 20, turnsOnCurrentGoal: undefined }))).toBe('ENRICH')
  })

  it('ignores malformed history rather than freezing a goal forever', () => {
    for (const bad of [NaN, -1, 'three']) {
      expect(
        decideFactionGoalReassessment(faction({ resources: 20, turnsOnCurrentGoal: bad as never })),
        String(bad)
      ).toBe('ENRICH')
    }
  })

  it('still picks the goal the circumstances call for once free', () => {
    const free = { turnsOnCurrentGoal: GOAL_COMMITMENT_TURNS, goal: 'CONSOLIDATE' as const }
    expect(decideFactionGoalReassessment(faction({ ...free, stability: 10 }))).toBe('DEFEND')
    expect(decideFactionGoalReassessment(faction({ ...free, resources: 10 }))).toBe('ENRICH')
    expect(decideFactionGoalReassessment(faction({ ...free, resources: 90, military: 90, hasRival: false }))).toBe('EXPAND')
    expect(decideFactionGoalReassessment(faction({ ...free, resources: 50, military: 40, hasRival: false }))).toBe('CONSOLIDATE')
  })
})

describe('the oscillation itself', () => {
  /** Runs the real tick + reassessment loop, tracking goal changes. */
  function simulate(withCommitment: boolean, turns = 30) {
    let state = { resources: 40, stability: 80, military: 90 }
    let goal: string = 'DESTABILIZE_RIVAL'
    let heldFor = 0
    let switches = 0

    for (let t = 0; t < turns; t++) {
      const next = decideFactionTick({ ...state, goal: goal as never })
      const decided = decideFactionGoalReassessment({
        ...next,
        goal: goal as never,
        hasRival: true,
        ...(withCommitment ? { turnsOnCurrentGoal: heldFor } : {}),
      })
      if (decided !== goal) {
        switches++
        heldFor = 0
      } else {
        heldFor++
      }
      goal = decided
      state = next
    }
    return switches
  }

  it('is real without commitment — this is the bug, reproduced', () => {
    // Roughly every other turn. Not an edge case; the steady state.
    expect(simulate(false)).toBeGreaterThan(10)
  })

  it('is gone with commitment', () => {
    // Some switching is correct — circumstances genuinely change. What must
    // not survive is flip-flopping across the same band boundary forever.
    const withMemory = simulate(true)
    expect(withMemory).toBeLessThan(simulate(false) / 2)
  })

  it('does not freeze the faction into one goal for good', () => {
    // The opposite failure: a world where nothing ever changes its mind is
    // as lifeless as one that changes it every turn.
    expect(simulate(true)).toBeGreaterThan(0)
  })
})
