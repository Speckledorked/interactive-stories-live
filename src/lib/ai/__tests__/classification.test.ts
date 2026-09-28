// src/lib/ai/__tests__/classification.test.ts
//
// The ClassificationProvider abstraction: OpenAI primary, Anthropic
// fallback (direct HTTPS, no SDK). Unit tests for the provider layer
// itself — the fallback ORDER and the failure taxonomy are covered in
// src/lib/game/__tests__/classificationFallback.test.ts through
// resolveActionMechanics.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const openaiFetch = vi.fn()
vi.mock('@/lib/ai/openaiCompat', () => ({ openaiFetch: (...a: unknown[]) => openaiFetch(...a) }))

import {
  openaiClassificationProvider,
  anthropicClassificationProvider,
  CLASSIFICATION_PROVIDERS,
  CLASSIFICATION_SYSTEM_PROMPT,
} from '../classification'
import { AI_MODELS } from '../models'

const fetchMock = vi.fn()
const realFetch = globalThis.fetch

const openaiEnvelope = (content: unknown) => ({
  ok: true,
  json: async () => ({
    choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
    usage: { prompt_tokens: 7, completion_tokens: 9 },
  }),
})

const anthropicEnvelope = (content: unknown) => ({
  ok: true,
  json: async () => ({
    content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content) }],
    usage: { input_tokens: 7, output_tokens: 9 },
  }),
})

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.fetch = fetchMock
  delete process.env.OPENAI_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_CLASSIFICATION_MODEL
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('openaiClassificationProvider', () => {
  it('is not configured without OPENAI_API_KEY', () => {
    expect(openaiClassificationProvider.isConfigured()).toBe(false)
  })

  it('is configured with OPENAI_API_KEY', () => {
    process.env.OPENAI_API_KEY = 'test-key'
    expect(openaiClassificationProvider.isConfigured()).toBe(true)
  })

  it('posts the chat-completions call with the efficient model and returns content, usage, and model', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    openaiFetch.mockResolvedValue(openaiEnvelope({ classifications: [] }))

    const result = await openaiClassificationProvider.classify('classify this')

    expect(openaiFetch).toHaveBeenCalledTimes(1)
    const [url, init] = openaiFetch.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer test-key')
    const body = JSON.parse(init.body)
    expect(body.model).toBe(AI_MODELS.EFFICIENT)
    expect(body.messages[0]).toMatchObject({ role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT })
    expect(body.messages[1]).toMatchObject({ role: 'user', content: 'classify this' })

    expect(result.content).toBe(JSON.stringify({ classifications: [] }))
    expect(result.usage).toEqual({ promptTokens: 7, completionTokens: 9 })
    expect(result.model).toBe(AI_MODELS.EFFICIENT)
  })

  it('throws on non-ok HTTP so the caller can try the next provider', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    openaiFetch.mockResolvedValue({ ok: false, status: 500 })

    await expect(openaiClassificationProvider.classify('x')).rejects.toThrow('500')
  })

  it('throws when the envelope has no message content', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    openaiFetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) })

    await expect(openaiClassificationProvider.classify('x')).rejects.toThrow('no message content')
  })
})

describe('anthropicClassificationProvider', () => {
  it('is not configured without the key', () => {
    process.env.ANTHROPIC_CLASSIFICATION_MODEL = 'some-model'
    expect(anthropicClassificationProvider.isConfigured()).toBe(false)
  })

  it('is not configured with a key but no model — half a setup is not a provider', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    expect(anthropicClassificationProvider.isConfigured()).toBe(false)
  })

  it('is configured with both key and model', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.ANTHROPIC_CLASSIFICATION_MODEL = 'some-model'
    expect(anthropicClassificationProvider.isConfigured()).toBe(true)
  })

  it('posts to the messages API with the pinned version, the env model, and the shared system prompt', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.ANTHROPIC_CLASSIFICATION_MODEL = 'claude-test-model'
    fetchMock.mockResolvedValue(anthropicEnvelope({ classifications: [] }))

    const result = await anthropicClassificationProvider.classify('classify this')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe('test-key')
    expect(init.headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(init.body)
    // The model is NEVER hardcoded — it comes from env.
    expect(body.model).toBe('claude-test-model')
    expect(body.system).toBe(CLASSIFICATION_SYSTEM_PROMPT)
    expect(body.messages).toEqual([{ role: 'user', content: 'classify this' }])

    expect(result.content).toBe(JSON.stringify({ classifications: [] }))
    expect(result.usage).toEqual({ promptTokens: 7, completionTokens: 9 })
    expect(result.model).toBe('claude-test-model')
  })

  it('throws on non-ok HTTP so the caller reports api-error after all providers fail', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.ANTHROPIC_CLASSIFICATION_MODEL = 'claude-test-model'
    fetchMock.mockResolvedValue({ ok: false, status: 529, text: async () => 'overloaded' })

    await expect(anthropicClassificationProvider.classify('x')).rejects.toThrow('529')
  })

  it('throws when the envelope has no text block', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.ANTHROPIC_CLASSIFICATION_MODEL = 'claude-test-model'
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ content: [], usage: {} }) })

    await expect(anthropicClassificationProvider.classify('x')).rejects.toThrow('no text content')
  })
})

describe('CLASSIFICATION_PROVIDERS', () => {
  it('tries OpenAI first and Anthropic second', () => {
    expect(CLASSIFICATION_PROVIDERS.map((p) => p.name)).toEqual(['openai', 'anthropic'])
  })
})
