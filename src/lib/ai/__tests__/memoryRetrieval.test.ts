import { describe, it, expect } from 'vitest'
import { filterAndRankMemories } from '../memoryRetrieval'
import type { RetrievedMemory } from '../memoryRetrieval'

function makeMemory(overrides: Partial<RetrievedMemory> = {}): RetrievedMemory {
  return {
    id: 'mem-1',
    turnNumber: 1,
    title: 'A thing happened',
    summary: 'Something happened.',
    memoryType: 'SCENE',
    importance: 'NORMAL',
    emotionalTone: null,
    similarity: 0.8,
    ...overrides,
  }
}

describe('filterAndRankMemories', () => {
  it('drops memories below the similarity threshold', () => {
    const memories = [makeMemory({ id: 'a', similarity: 0.9 }), makeMemory({ id: 'b', similarity: 0.5 })]
    const result = filterAndRankMemories(memories, { minSimilarity: 0.7, importanceBoost: false, maxMemories: 10 })
    expect(result.map((m) => m.id)).toEqual(['a'])
  })

  it('caps results at maxMemories', () => {
    const memories = Array.from({ length: 5 }, (_, i) => makeMemory({ id: `m${i}`, similarity: 0.9 }))
    const result = filterAndRankMemories(memories, { minSimilarity: 0.7, importanceBoost: false, maxMemories: 2 })
    expect(result).toHaveLength(2)
  })

  it('leaves order untouched when importanceBoost is off', () => {
    const memories = [
      makeMemory({ id: 'critical-but-lower-sim', similarity: 0.71, importance: 'CRITICAL' }),
      makeMemory({ id: 'normal-higher-sim', similarity: 0.9, importance: 'NORMAL' }),
    ]
    const result = filterAndRankMemories(memories, { minSimilarity: 0.7, importanceBoost: false, maxMemories: 10 })
    expect(result.map((m) => m.id)).toEqual(['critical-but-lower-sim', 'normal-higher-sim'])
  })

  it('boosts a CRITICAL memory above a NORMAL one with slightly higher raw similarity', () => {
    // 0.71 * 1.3 = 0.923 > 0.9 * 1.0 = 0.9 — CRITICAL should win despite lower similarity
    const memories = [
      makeMemory({ id: 'normal-higher-sim', similarity: 0.9, importance: 'NORMAL' }),
      makeMemory({ id: 'critical-lower-sim', similarity: 0.71, importance: 'CRITICAL' }),
    ]
    const result = filterAndRankMemories(memories, { minSimilarity: 0.7, importanceBoost: true, maxMemories: 10 })
    expect(result[0].id).toBe('critical-lower-sim')
  })

  it('does not let a large similarity gap be overcome by importance alone', () => {
    // 0.75 * 1.3 = 0.975 < 0.95 * 1.0 = 0.95 is false actually — pick numbers where NORMAL still wins:
    // 0.95 * 1.0 = 0.95 > 0.72 * 1.3 = 0.936
    const memories = [
      makeMemory({ id: 'normal-much-higher-sim', similarity: 0.95, importance: 'NORMAL' }),
      makeMemory({ id: 'critical-much-lower-sim', similarity: 0.72, importance: 'CRITICAL' }),
    ]
    const result = filterAndRankMemories(memories, { minSimilarity: 0.7, importanceBoost: true, maxMemories: 10 })
    expect(result[0].id).toBe('normal-much-higher-sim')
  })

  it('treats an unrecognized importance value as an unboosted 1.0 weight', () => {
    const memories = [makeMemory({ id: 'unknown', similarity: 0.8, importance: 'SOMETHING_NEW' })]
    const result = filterAndRankMemories(memories, { minSimilarity: 0.7, importanceBoost: true, maxMemories: 10 })
    expect(result).toHaveLength(1)
  })
})
