// src/lib/ai/__tests__/scenePrompt.test.ts
//
// #115: outcome-band-driven narration pacing. buildOutcomeBandSection
// itself isn't exported (matches this file's own convention — only
// buildSystemPrompt/buildUserPrompt are), so it's exercised through
// buildSystemPrompt's actual output, the same way a real caller would see it.

import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../scenePrompt'
import type { AIGMRequest } from '../client'
import type { ActionMechanics } from '@/lib/game/resolution'

function makeRequest(actionMechanics: Partial<ActionMechanics>[] = []): AIGMRequest {
  return {
    campaign_universe: 'Test Universe',
    ai_system_prompt: 'Be a good GM.',
    action_mechanics: actionMechanics as ActionMechanics[],
  } as unknown as AIGMRequest
}

function mechanic(outcome: ActionMechanics['outcome']): Partial<ActionMechanics> {
  return { characterId: 'char-1', characterName: 'Kess', outcome }
}

describe('buildSystemPrompt — outcome-band pacing (#115)', () => {
  it('omits the section entirely when no roll happened this exchange', () => {
    const prompt = buildSystemPrompt(makeRequest([]))
    expect(prompt).not.toContain('<outcome_band_pacing>')
  })

  it('omits the section when action_mechanics is undefined', () => {
    const request = { campaign_universe: 'Test', ai_system_prompt: 'x' } as unknown as AIGMRequest
    expect(buildSystemPrompt(request)).not.toContain('<outcome_band_pacing>')
  })

  it('includes strong-hit pacing guidance for a clean success', () => {
    const prompt = buildSystemPrompt(makeRequest([mechanic('strongHit')]))
    expect(prompt).toContain('<outcome_band_pacing>')
    expect(prompt).toContain('clean, unqualified success')
  })

  it('includes weak-hit pacing guidance for a success with a cost', () => {
    const prompt = buildSystemPrompt(makeRequest([mechanic('weakHit')]))
    expect(prompt).toContain('success with a real cost')
  })

  it('includes miss pacing guidance for a setback', () => {
    const prompt = buildSystemPrompt(makeRequest([mechanic('miss')]))
    expect(prompt).toContain('genuine setback')
  })

  it('paces the whole exchange as a miss when any action missed, even if others succeeded', () => {
    const prompt = buildSystemPrompt(makeRequest([mechanic('strongHit'), mechanic('miss'), mechanic('weakHit')]))
    expect(prompt).toContain('genuine setback')
    expect(prompt).not.toContain('clean, unqualified success')
  })
})
