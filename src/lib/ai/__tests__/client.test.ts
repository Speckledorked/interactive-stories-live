// src/lib/ai/__tests__/client.test.ts
//
// #116: multi-model fallback chain — AI_MODELS.FLAGSHIP first, one fallback
// attempt against AI_MODELS.EFFICIENT on a hard failure or an already-open
// circuit breaker, never chained further.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    worldMeta: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    aICostEntry: { create: vi.fn().mockResolvedValue({}) },
  },
}))

import { callAIGM } from '../client'
import type { AIGMRequest } from '../client'
import { circuitBreakerManager } from '../circuit-breaker'
import { AI_MODELS } from '../models'

function jsonResponse(content: object, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () =>
      ok
        ? { choices: [{ message: { content: JSON.stringify(content) } }], usage: {} }
        : { error: 'boom' },
  }
}

const validContent = { scene_text: 'A'.repeat(60), time_passage: { hours: 0 }, world_updates: {} }

function makeRequest(): AIGMRequest {
  return {
    campaign_universe: 'Test',
    ai_system_prompt: 'Be a good GM.',
    world_summary: {
      turn_number: 1,
      in_game_date: 'Day 1',
      characters: [],
      npcs: [],
      factions: [],
      clocks: [],
      recent_timeline_events: [],
    },
    current_scene_intro: 'It begins.',
    player_actions: [],
  } as unknown as AIGMRequest
}

describe('callAIGM — multi-model fallback (#116)', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('serves from FLAGSHIP on a normal successful call — no fallback attempted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(validContent))
    vi.stubGlobal('fetch', fetchMock)

    const result = await callAIGM(makeRequest(), 'campaign-flagship-ok')

    expect(result.scene_text).toContain('AAA')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe(AI_MODELS.FLAGSHIP)
  })

  it('falls back to EFFICIENT once when the FLAGSHIP attempt hard-fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, false)) // FLAGSHIP: hard failure
      .mockResolvedValueOnce(jsonResponse(validContent)) // EFFICIENT: succeeds
    vi.stubGlobal('fetch', fetchMock)

    const result = await callAIGM(makeRequest(), 'campaign-fallback-ok')

    expect(result.scene_text).toContain('AAA')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)
    expect(firstBody.model).toBe(AI_MODELS.FLAGSHIP)
    expect(secondBody.model).toBe(AI_MODELS.EFFICIENT)
  })

  it('surfaces the error when both FLAGSHIP and the EFFICIENT fallback fail', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, false))
    vi.stubGlobal('fetch', fetchMock)

    await expect(callAIGM(makeRequest(), 'campaign-both-fail')).rejects.toThrow()
    // Exactly one primary attempt and exactly one fallback attempt — never
    // chained further than that.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('skips straight to the EFFICIENT fallback when the circuit breaker is already open', async () => {
    const campaignId = 'campaign-circuit-open'
    const breaker = circuitBreakerManager.getBreaker(campaignId)
    // Default failureThreshold is 3 — force it open before this call.
    breaker.recordFailure(new Error('prior failure 1'))
    breaker.recordFailure(new Error('prior failure 2'))
    breaker.recordFailure(new Error('prior failure 3'))
    expect(breaker.canAttempt()).toBe(false)

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(validContent))
    vi.stubGlobal('fetch', fetchMock)

    const result = await callAIGM(makeRequest(), campaignId)

    expect(result.scene_text).toContain('AAA')
    // Only the fallback attempt ran — FLAGSHIP was never tried while the
    // circuit was open.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe(AI_MODELS.EFFICIENT)
  })
})
