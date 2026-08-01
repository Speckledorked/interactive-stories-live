import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockEmbeddingsCreate = vi.fn()

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function MockOpenAI() {
    return { embeddings: { create: mockEmbeddingsCreate } }
  }),
}))

vi.mock('../cost-tracker', () => ({
  recordAICost: vi.fn().mockResolvedValue(undefined),
  estimateTokenCount: (text: string) => Math.ceil(text.length / 4),
}))

import { recordAICost } from '../cost-tracker'
import { generateEmbeddingsBatch, embedBatchWithCostTracking } from '../embeddingService'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('generateEmbeddingsBatch', () => {
  it('embeds multiple texts in one API call, preserving order', async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: [1, 0] }, { embedding: [0, 1] }, { embedding: [1, 1] }],
    })

    const result = await generateEmbeddingsBatch(['a', 'b', 'c'])

    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1)
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
      model: 'text-embedding-ada-002',
      input: ['a', 'b', 'c'],
    })
    expect(result).toEqual([[1, 0], [0, 1], [1, 1]])
  })

  it('returns [] for an empty input without calling the API', async () => {
    const result = await generateEmbeddingsBatch([])
    expect(result).toEqual([])
    expect(mockEmbeddingsCreate).not.toHaveBeenCalled()
  })

  it('throws a wrapped error when the API call fails, same as generateEmbedding', async () => {
    mockEmbeddingsCreate.mockRejectedValue(new Error('rate limited'))
    await expect(generateEmbeddingsBatch(['a'])).rejects.toThrow('Failed to generate batch embeddings')
  })

  it('truncates each text to the same safe length generateEmbedding uses', async () => {
    mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: [1] }] })
    const longText = 'x'.repeat(9000)

    await generateEmbeddingsBatch([longText])

    const call = mockEmbeddingsCreate.mock.calls[0][0]
    expect(call.input[0].length).toBe(8000)
  })
})

describe('embedBatchWithCostTracking', () => {
  it('records one recordAICost call for the whole batch, with summed input tokens', async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: [1, 0] }, { embedding: [0, 1] }],
    })

    const vectors = await embedBatchWithCostTracking('camp1', ['aaaa', 'bbbbbbbb'], 'lore_import_embedding')

    expect(vectors).toEqual(['[1,0]', '[0,1]'])
    expect(recordAICost).toHaveBeenCalledTimes(1)
    const call = vi.mocked(recordAICost).mock.calls[0][0]
    expect(call.campaignId).toBe('camp1')
    expect(call.requestType).toBe('lore_import_embedding')
    // 'aaaa' (4 chars -> 1 token) + 'bbbbbbbb' (8 chars -> 2 tokens) = 3
    expect(call.inputTokens).toBe(3)
    expect(call.outputTokens).toBe(0)
  })
})
