// src/lib/ai/__tests__/sceneResolutionRequest.test.ts
//
// A real scene reported stuck at 60 exchanges despite scenePrompt.ts's
// urgent <pacing> tier being a "HARD REQUIREMENT" for every exchange since
// 15 — prose urging alone is not a guarantee the model actually complies.
// deriveEffectiveSceneEnding is the pure decision behind the backstop:
// past SCENE_RUNAWAY_EXCHANGE_CEILING, force the same <scene_ending>
// treatment an explicit end-scene action gets.

import { describe, it, expect } from 'vitest'
import { deriveEffectiveSceneEnding, SCENE_RUNAWAY_EXCHANGE_CEILING } from '../sceneResolutionRequest'

describe('deriveEffectiveSceneEnding', () => {
  it('stays false for an ordinary, non-runaway scene', () => {
    expect(deriveEffectiveSceneEnding(false, 3)).toBe(false)
    expect(deriveEffectiveSceneEnding(false, SCENE_RUNAWAY_EXCHANGE_CEILING - 1)).toBe(false)
  })

  it('forces true once a scene reaches the runaway ceiling', () => {
    expect(deriveEffectiveSceneEnding(false, SCENE_RUNAWAY_EXCHANGE_CEILING)).toBe(true)
    expect(deriveEffectiveSceneEnding(false, SCENE_RUNAWAY_EXCHANGE_CEILING + 35)).toBe(true)
  })

  it('an explicit end-scene request always wins, regardless of exchange count', () => {
    expect(deriveEffectiveSceneEnding(true, 0)).toBe(true)
    expect(deriveEffectiveSceneEnding(true, 1)).toBe(true)
  })

  it('treats a null/undefined exchange count as 0, not runaway', () => {
    expect(deriveEffectiveSceneEnding(false, null)).toBe(false)
  })
})
