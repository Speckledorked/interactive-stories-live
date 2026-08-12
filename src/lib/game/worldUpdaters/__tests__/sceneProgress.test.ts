// src/lib/game/worldUpdaters/__tests__/sceneProgress.test.ts
//
// The scene progress ledger replaces re-deriving "what's already happened"
// from raw prose each exchange. These tests pin the two behaviors that
// matter most: events (facts/beats) accumulate and dedupe, state
// (activeConflict/npcIntentions) overwrites — and lastProgressExchange only
// advances on real progress, since that's the actual stall-detection signal
// buildPacingSection reads.

import { describe, it, expect } from 'vitest'
import {
  applySceneProgress,
  parseSceneProgressState,
  createDefaultSceneProgressState,
  MAX_ESTABLISHED_FACTS,
  MAX_RESOLVED_BEATS,
} from '../sceneProgress'
import type { SceneProgress } from '@/lib/ai/schema'

describe('parseSceneProgressState', () => {
  it('returns a default empty ledger for null (a scene created before this existed)', () => {
    expect(parseSceneProgressState(null)).toEqual(createDefaultSceneProgressState())
  })

  it('returns a default empty ledger for malformed JSON rather than throwing', () => {
    expect(parseSceneProgressState('not an object')).toEqual(createDefaultSceneProgressState())
    expect(parseSceneProgressState([1, 2, 3])).toEqual(createDefaultSceneProgressState())
  })

  it('round-trips a well-formed state', () => {
    const state = {
      establishedFacts: ['The bridge is out'],
      resolvedBeats: [{ exchange: 2, text: 'Persuaded the guard', significant: true }],
      activeConflict: 'Convincing the smuggler to talk',
      npcIntentions: { 'Guard Captain': 'Stalling for reinforcements' },
      lastProgressExchange: 2,
      recentMoves: ['extract a cost', 'inflict harm'],
    }
    expect(parseSceneProgressState(state)).toEqual(state)
  })
})

describe('applySceneProgress — recent moves (#232)', () => {
  it('leaves recentMoves empty when nothing was reported this exchange', () => {
    const result = applySceneProgress(null, undefined, 1)
    expect(result.progressState.recentMoves).toEqual([])
  })

  it('appends moves used this exchange', () => {
    const result = applySceneProgress(null, undefined, 1, ['inflict harm'])
    expect(result.progressState.recentMoves).toEqual(['inflict harm'])
  })

  it('accumulates across exchanges and bounds at MAX_RECENT_MOVES', () => {
    let state: unknown = null
    for (let i = 0; i < 8; i++) {
      const result = applySceneProgress(state, undefined, i, [`move ${i}`])
      state = result.progressState
    }
    const finalState = state as { recentMoves: string[] }
    expect(finalState.recentMoves).toHaveLength(5) // MAX_RECENT_MOVES
    expect(finalState.recentMoves).toEqual(['move 3', 'move 4', 'move 5', 'move 6', 'move 7'])
  })

  it('does not touch recentMoves when no moves are passed this exchange', () => {
    const existing = { ...createDefaultSceneProgressState(), recentMoves: ['extract a cost'] }
    const result = applySceneProgress(existing, undefined, 3)
    expect(result.progressState.recentMoves).toEqual(['extract a cost'])
  })
})

describe('applySceneProgress — established facts', () => {
  it('adds new facts', () => {
    const report: SceneProgress = { new_established_facts: ['The bridge is out'] }
    const result = applySceneProgress(null, report, 1)
    expect(result.progressState.establishedFacts).toEqual(['The bridge is out'])
  })

  it('dedupes a fact already established, case/whitespace/punctuation-insensitive', () => {
    const existing = { ...createDefaultSceneProgressState(), establishedFacts: ['The bridge is out'] }
    const report: SceneProgress = { new_established_facts: ['the bridge is out.', '  The Bridge Is Out  '] }
    const result = applySceneProgress(existing, report, 3)
    expect(result.progressState.establishedFacts).toEqual(['The bridge is out'])
  })

  it('caps established facts at MAX_ESTABLISHED_FACTS, dropping the oldest', () => {
    const existing = {
      ...createDefaultSceneProgressState(),
      establishedFacts: Array.from({ length: MAX_ESTABLISHED_FACTS }, (_, i) => `Fact ${i}`),
    }
    const report: SceneProgress = { new_established_facts: ['A brand new fact'] }
    const result = applySceneProgress(existing, report, 5)
    expect(result.progressState.establishedFacts).toHaveLength(MAX_ESTABLISHED_FACTS)
    expect(result.progressState.establishedFacts[0]).toBe('Fact 1') // "Fact 0" trimmed
    expect(result.progressState.establishedFacts.at(-1)).toBe('A brand new fact')
  })

  it('does not count a new fact alone as progress (only beats/activeConflict do)', () => {
    const report: SceneProgress = { new_established_facts: ['The bridge is out'] }
    const result = applySceneProgress(null, report, 1)
    expect(result.madeProgress).toBe(false)
    expect(result.progressState.lastProgressExchange).toBe(0)
  })
})

describe('applySceneProgress — resolved beats', () => {
  it('adds a new beat and marks it as progress', () => {
    const report: SceneProgress = { new_resolved_beats: [{ text: 'Persuaded the guard', significant: false }] }
    const result = applySceneProgress(null, report, 2)
    expect(result.progressState.resolvedBeats).toEqual([{ exchange: 2, text: 'Persuaded the guard', significant: false }])
    expect(result.madeProgress).toBe(true)
    expect(result.progressState.lastProgressExchange).toBe(2)
  })

  it('surfaces only newly-added significant beats, not the whole history', () => {
    const existing = {
      ...createDefaultSceneProgressState(),
      resolvedBeats: [{ exchange: 1, text: 'Old significant beat', significant: true }],
    }
    const report: SceneProgress = {
      new_resolved_beats: [
        { text: 'Old significant beat', significant: true }, // duplicate, already resolved
        { text: 'New significant beat', significant: true },
        { text: 'New minor beat', significant: false },
      ],
    }
    const result = applySceneProgress(existing, report, 3)
    expect(result.newSignificantBeats).toEqual(['New significant beat'])
    expect(result.progressState.resolvedBeats).toHaveLength(3)
  })

  it('dedupes a beat already resolved', () => {
    const existing = {
      ...createDefaultSceneProgressState(),
      resolvedBeats: [{ exchange: 1, text: 'Found the hidden door', significant: false }],
    }
    const report: SceneProgress = { new_resolved_beats: [{ text: 'found the hidden door', significant: false }] }
    const result = applySceneProgress(existing, report, 4)
    expect(result.progressState.resolvedBeats).toHaveLength(1)
    expect(result.madeProgress).toBe(false)
  })

  it('caps resolved beats at MAX_RESOLVED_BEATS, dropping the oldest', () => {
    const existing = {
      ...createDefaultSceneProgressState(),
      resolvedBeats: Array.from({ length: MAX_RESOLVED_BEATS }, (_, i) => ({ exchange: i, text: `Beat ${i}`, significant: false })),
    }
    const report: SceneProgress = { new_resolved_beats: [{ text: 'A brand new beat', significant: false }] }
    const result = applySceneProgress(existing, report, 20)
    expect(result.progressState.resolvedBeats).toHaveLength(MAX_RESOLVED_BEATS)
    expect(result.progressState.resolvedBeats[0].text).toBe('Beat 1')
    expect(result.progressState.resolvedBeats.at(-1)?.text).toBe('A brand new beat')
  })
})

describe('applySceneProgress — active conflict (state, not log)', () => {
  it('sets the active conflict and counts it as progress', () => {
    const report: SceneProgress = { active_conflict: 'Convincing the smuggler to talk' }
    const result = applySceneProgress(null, report, 1)
    expect(result.progressState.activeConflict).toBe('Convincing the smuggler to talk')
    expect(result.madeProgress).toBe(true)
  })

  it('overwrites rather than appending when the conflict genuinely changes', () => {
    const existing = { ...createDefaultSceneProgressState(), activeConflict: 'Old conflict' }
    const report: SceneProgress = { active_conflict: 'New conflict' }
    const result = applySceneProgress(existing, report, 5)
    expect(result.progressState.activeConflict).toBe('New conflict')
  })

  it('reporting the same active conflict again is not progress — a real stall', () => {
    const existing = { ...createDefaultSceneProgressState(), activeConflict: 'Same conflict', lastProgressExchange: 2 }
    const report: SceneProgress = { active_conflict: 'Same conflict' }
    const result = applySceneProgress(existing, report, 6)
    expect(result.madeProgress).toBe(false)
    expect(result.progressState.lastProgressExchange).toBe(2) // unchanged — this IS the stall signal
  })
})

describe('applySceneProgress — NPC intentions (state, not log)', () => {
  it('sets an intention per NPC and overwrites it on update, without counting as progress', () => {
    const report: SceneProgress = {
      npc_intentions: [{ npc_name_or_id: 'Guard Captain', intention: 'Stalling for reinforcements' }],
    }
    const result = applySceneProgress(null, report, 1)
    expect(result.progressState.npcIntentions).toEqual({ 'Guard Captain': 'Stalling for reinforcements' })
    expect(result.madeProgress).toBe(false)

    const nextReport: SceneProgress = {
      npc_intentions: [{ npc_name_or_id: 'Guard Captain', intention: 'Drawing his sword' }],
    }
    const nextResult = applySceneProgress(result.progressState, nextReport, 2)
    expect(nextResult.progressState.npcIntentions).toEqual({ 'Guard Captain': 'Drawing his sword' })
  })
})

describe('applySceneProgress — a quiet exchange with nothing to report', () => {
  it('leaves the ledger untouched and is not progress', () => {
    const existing = {
      ...createDefaultSceneProgressState(),
      establishedFacts: ['The bridge is out'],
      lastProgressExchange: 1,
    }
    const result = applySceneProgress(existing, undefined, 5)
    expect(result.progressState).toEqual(existing)
    expect(result.madeProgress).toBe(false)
    expect(result.newSignificantBeats).toEqual([])
  })
})
