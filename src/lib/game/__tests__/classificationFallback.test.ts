// src/lib/game/__tests__/classificationFallback.test.ts
//
// The classification VENDOR fallback: OpenAI primary, Anthropic second.
// These go through resolveActionMechanics (the real caller) rather than
// calling the providers directly, because the contract under test is the
// fallback ORDER and the failure TAXONOMY:
//   - primary succeeds → fallback never called, cost billed to OpenAI's model
//   - primary transport/API failure → fallback called, success still succeeds
//   - both fail → graceful degradation, 'api-error' (NOT 'no-api-key')
//   - nothing configured → 'no-api-key' (NOT 'api-error')
//   - primary returns unusable output → 'unusable-output', fallback NOT tried
//     (the call was billed; retrying another model on validation failure
//     is a billing decision, not a reliability one)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const openaiFetch = vi.fn()
vi.mock('@/lib/ai/openaiCompat', () => ({ openaiFetch: (...a: unknown[]) => openaiFetch(...a) }))
vi.mock('@/lib/ai/cost-tracker', () => ({
  recordAICost: vi.fn(async () => {}),
  estimateTokenCount: () => 10,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    character: { findMany: vi.fn(), update: vi.fn(async () => ({})) },
    faction: { findMany: vi.fn(async () => []) },
    nPC: { findMany: vi.fn(async () => []) },
    location: { findMany: vi.fn(async () => []) },
    move: { findMany: vi.fn(async () => []) },
    campaign: { findUnique: vi.fn(async () => ({ corruptionTheme: null })) },
    debt: { findMany: vi.fn(async () => []) },
    diceRoll: { create: vi.fn() },
    playerAction: { update: vi.fn(async () => ({})) },
  },
}))

import { prisma } from '@/lib/prisma'
import { recordAICost } from '@/lib/ai/cost-tracker'
import { AI_MODELS } from '@/lib/ai/models'
import { resolveActionMechanics } from '../resolution'

const character = (id: string, name: string) => ({
  id, name,
  stats: { cool: 1, hard: 0, hot: 0, sharp: 0, weird: 0 },
  harm: 0, corruption: 0, pendingBargain: null,
  capabilities: [], factionStandings: [],
  relationships: null, consequences: null, conditions: null,
  perks: [], moves: [],
  currentLocation: null, locationId: null,
  currentZone: null, zoneMetadata: null,
})

const validClassification = { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool' }

/** The classifier's HTTP response, shaped as the real OpenAI endpoint returns it. */
const openaiReturning = (classifications: unknown[]) => ({
  ok: true,
  json: async () => ({
    choices: [{ message: { content: JSON.stringify({ classifications }) } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }),
})

/** Shaped as the real Anthropic messages endpoint returns it. */
const anthropicReturning = (classifications: unknown[]) => ({
  ok: true,
  json: async () => ({
    content: [{ type: 'text', text: JSON.stringify({ classifications }) }],
    usage: { input_tokens: 2, output_tokens: 2 },
  }),
})

const fetchMock = vi.fn()
const realFetch = globalThis.fetch
const anthropicCalls = () =>
  fetchMock.mock.calls.filter(([url]) => url === 'https://api.anthropic.com/v1/messages')

let rollSeq = 0
const actions = [
  { id: 'act1', characterId: 'char1', userId: 'u1', actionText: 'Vault the railing' },
]

beforeEach(() => {
  vi.clearAllMocks()
  rollSeq = 0
  globalThis.fetch = fetchMock
  process.env.OPENAI_API_KEY = 'test-openai-key'
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
  process.env.ANTHROPIC_CLASSIFICATION_MODEL = 'claude-test-model'
  ;(prisma.diceRoll.create as any).mockImplementation(async () => ({ id: `roll-${++rollSeq}` }))
  ;(prisma.character.findMany as any).mockResolvedValue([character('char1', 'Jason')])
})

afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_CLASSIFICATION_MODEL
})

describe('classification vendor fallback', () => {
  it('does not call the fallback when OpenAI succeeds, and bills the OpenAI model', async () => {
    openaiFetch.mockResolvedValue(openaiReturning([validClassification]))

    const result = await resolveActionMechanics('camp1', 'scene1', actions, () => 0.5)

    expect(result.classificationUnavailable).toBe(false)
    expect(result.mechanics).toHaveLength(1)
    expect(anthropicCalls()).toHaveLength(0)
    expect(recordAICost).toHaveBeenCalledWith(expect.objectContaining({ model: AI_MODELS.EFFICIENT }))
  })

  it('falls back to Anthropic when the OpenAI call throws, and bills the Anthropic model', async () => {
    openaiFetch.mockRejectedValue(new Error('upstream down'))
    fetchMock.mockResolvedValue(anthropicReturning([validClassification]))

    const result = await resolveActionMechanics('camp1', 'scene1', actions, () => 0.5)

    expect(result.classificationUnavailable).toBe(false)
    expect(result.mechanics).toHaveLength(1)
    expect(anthropicCalls()).toHaveLength(1)
    // recordAICost must use the provider's ACTUAL model, not AI_MODELS.EFFICIENT.
    expect(recordAICost).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-test-model' }))
  })

  it('falls back to Anthropic when OpenAI returns non-ok HTTP', async () => {
    openaiFetch.mockResolvedValue({ ok: false, status: 500 })
    fetchMock.mockResolvedValue(anthropicReturning([validClassification]))

    const result = await resolveActionMechanics('camp1', 'scene1', actions, () => 0.5)

    expect(result.classificationUnavailable).toBe(false)
    expect(result.mechanics).toHaveLength(1)
    expect(anthropicCalls()).toHaveLength(1)
  })

  it('degrades gracefully with api-error when BOTH providers fail — still not no-api-key', async () => {
    openaiFetch.mockRejectedValue(new Error('openai down'))
    fetchMock.mockRejectedValue(new Error('anthropic down'))

    const result = await resolveActionMechanics('camp1', 'scene1', actions, () => 0.5)

    expect(result.mechanics).toEqual([])
    expect(result.classificationUnavailable).toBe(true)
    expect(result.unavailableReason).toBe('api-error')
    expect(prisma.diceRoll.create).not.toHaveBeenCalled()
  })

  it('reports no-api-key when NO provider is configured — distinguishable from api-error', async () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_CLASSIFICATION_MODEL

    const result = await resolveActionMechanics('camp1', 'scene1', actions, () => 0.5)

    expect(result.mechanics).toEqual([])
    expect(result.classificationUnavailable).toBe(true)
    expect(result.unavailableReason).toBe('no-api-key')
    expect(openaiFetch).not.toHaveBeenCalled()
    expect(anthropicCalls()).toHaveLength(0)
  })

  it('does NOT fall back when OpenAI returns unusable output — the call was billed', async () => {
    openaiFetch.mockResolvedValue(openaiReturning([
      { action_index: 0, move_name: 'Act Under Fire', stat_key: null },
    ]))

    const result = await resolveActionMechanics('camp1', 'scene1', actions, () => 0.5)

    expect(result.classificationUnavailable).toBe(true)
    expect(result.unavailableReason).toBe('unusable-output')
    expect(result.droppedFields).toContain('stat_key')
    // A validation failure is not a transport failure: the fallback stays cold.
    expect(anthropicCalls()).toHaveLength(0)
    expect(prisma.diceRoll.create).not.toHaveBeenCalled()
  })

  it('still classifies when only Anthropic is configured', async () => {
    delete process.env.OPENAI_API_KEY
    fetchMock.mockResolvedValue(anthropicReturning([validClassification]))

    const result = await resolveActionMechanics('camp1', 'scene1', actions, () => 0.5)

    expect(result.classificationUnavailable).toBe(false)
    expect(result.mechanics).toHaveLength(1)
    expect(openaiFetch).not.toHaveBeenCalled()
    expect(anthropicCalls()).toHaveLength(1)
  })

  it('treats a key without a model as unconfigured — half a setup does not burn the fallback slot', async () => {
    delete process.env.ANTHROPIC_CLASSIFICATION_MODEL
    delete process.env.OPENAI_API_KEY

    const result = await resolveActionMechanics('camp1', 'scene1', actions, () => 0.5)

    expect(result.unavailableReason).toBe('no-api-key')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
