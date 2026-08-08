// src/lib/ai/__tests__/sceneStakes.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
  },
}))

vi.mock('../cost-tracker', async () => {
  const actual = await vi.importActual<typeof import('../cost-tracker')>('../cost-tracker')
  return { ...actual, recordAICost: vi.fn().mockResolvedValue(undefined) }
})

import { prisma } from '@/lib/prisma'
import { recordAICost } from '../cost-tracker'
import { generateSceneStakes, validateGeneratedStakes } from '../sceneStakes'

const db = prisma as any

function mockCompletion(content: object | string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
      usage: { prompt_tokens: 80, completion_tokens: 20 },
    }),
  })
}

const introText = 'The village of Ashford burns as raiders pour through the broken gate, and the last defenders fall back toward the granary.'

describe('validateGeneratedStakes', () => {
  it('accepts a well-formed stakes statement', () => {
    expect(validateGeneratedStakes({ stakes: 'If the granary falls, the village starves through winter.' }))
      .toBe('If the granary falls, the village starves through winter.')
  })

  it('trims whitespace', () => {
    expect(validateGeneratedStakes({ stakes: '  Short but valid stakes.  ' })).toBe('Short but valid stakes.')
  })

  it('rejects a non-object', () => {
    expect(validateGeneratedStakes(null)).toBeNull()
    expect(validateGeneratedStakes('a string')).toBeNull()
  })

  it('rejects a missing/non-string stakes field', () => {
    expect(validateGeneratedStakes({})).toBeNull()
    expect(validateGeneratedStakes({ stakes: 123 })).toBeNull()
  })

  it('rejects a too-short stakes statement', () => {
    expect(validateGeneratedStakes({ stakes: 'Short.' })).toBeNull()
  })

  it('rejects a too-long stakes statement', () => {
    expect(validateGeneratedStakes({ stakes: 'A'.repeat(400) })).toBeNull()
  })

  it('rejects a stakes value that still looks like JSON', () => {
    expect(validateGeneratedStakes({ stakes: '{"still": "structured", "padding": "to pass length"}' })).toBeNull()
  })
})

describe('generateSceneStakes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.mocked(recordAICost).mockClear()
    db.campaign.findUnique.mockReset()
  })

  it('returns null without an API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(await generateSceneStakes('camp1', introText)).toBeNull()
  })

  it('returns null when the scene intro text is too short to ground a real answer', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    expect(await generateSceneStakes('camp1', 'Too short.')).toBeNull()
  })

  it('returns null when the campaign cannot be found', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    db.campaign.findUnique.mockResolvedValue(null)
    expect(await generateSceneStakes('camp1', introText)).toBeNull()
  })

  it('returns null on API error', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    db.campaign.findUnique.mockResolvedValue({ title: 'Ashford', universe: 'Fantasy' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    expect(await generateSceneStakes('camp1', introText)).toBeNull()
  })

  it('returns null on malformed JSON content', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    db.campaign.findUnique.mockResolvedValue({ title: 'Ashford', universe: 'Fantasy' })
    vi.stubGlobal('fetch', mockCompletion('not json'))
    expect(await generateSceneStakes('camp1', introText)).toBeNull()
  })

  it('returns null when the response fails validation', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    db.campaign.findUnique.mockResolvedValue({ title: 'Ashford', universe: 'Fantasy' })
    vi.stubGlobal('fetch', mockCompletion({ stakes: 'Short.' }))
    expect(await generateSceneStakes('camp1', introText)).toBeNull()
  })

  it('returns the stakes statement and records cost on success', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    db.campaign.findUnique.mockResolvedValue({ title: 'Ashford', universe: 'Fantasy' })
    const stakes = 'If the granary falls, the village starves through winter.'
    vi.stubGlobal('fetch', mockCompletion({ stakes }))

    const result = await generateSceneStakes('camp1', introText)

    expect(result).toBe(stakes)
    expect(recordAICost).toHaveBeenCalledTimes(1)
    expect(recordAICost).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'camp1', requestType: 'scene_stakes', success: true })
    )
  })

  it('does not record cost when the response fails validation', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    db.campaign.findUnique.mockResolvedValue({ title: 'Ashford', universe: 'Fantasy' })
    vi.stubGlobal('fetch', mockCompletion({ stakes: 'Short.' }))
    await generateSceneStakes('camp1', introText)
    expect(recordAICost).not.toHaveBeenCalled()
  })
})
