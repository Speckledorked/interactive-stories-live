// src/lib/lore/__tests__/textChunker.test.ts
import { describe, it, expect } from 'vitest'
import { chunkText } from '../textChunker'

describe('chunkText', () => {
  it('returns nothing for empty/whitespace text', () => {
    expect(chunkText('', 'Title')).toEqual([])
    expect(chunkText('   \n\n  ', 'Title')).toEqual([])
  })

  it('keeps short text as a single chunk with the plain title', () => {
    const result = chunkText('A short paragraph of lore.', 'The Sundered Veil')
    expect(result).toEqual([{ title: 'The Sundered Veil', content: 'A short paragraph of lore.' }])
  })

  it('splits long text into multiple numbered chunks', () => {
    const paragraph = 'Sentence one. '.repeat(50) // ~700 chars
    const text = [paragraph, paragraph, paragraph].join('\n\n') // ~2100 chars
    const result = chunkText(text, 'Essence Magic', { maxChars: 1000, overlapChars: 50 })

    expect(result.length).toBeGreaterThan(1)
    expect(result[0].title).toBe('Essence Magic (part 1)')
    expect(result[1].title).toBe('Essence Magic (part 2)')
    for (const chunk of result) {
      expect(chunk.content.length).toBeLessThanOrEqual(1200) // maxChars + a little overlap slack
    }
  })

  it('carries overlap between consecutive chunks', () => {
    const paragraph = 'Word '.repeat(300) // long single paragraph, forces sentence-less split path too
    const result = chunkText(paragraph, 'Long Article', { maxChars: 500, overlapChars: 100 })

    expect(result.length).toBeGreaterThan(1)
    const tailOfFirst = result[0].content.slice(-50)
    expect(result[1].content).toContain(tailOfFirst.trim().split(' ').slice(-3).join(' '))
  })

  it('splits an oversized single paragraph on sentence boundaries', () => {
    const sentences = Array.from({ length: 40 }, (_, i) => `This is sentence number ${i}.`).join(' ')
    const result = chunkText(sentences, 'One Big Paragraph', { maxChars: 300, overlapChars: 0 })

    expect(result.length).toBeGreaterThan(1)
    // No chunk should be dramatically over the limit.
    for (const chunk of result) {
      expect(chunk.content.length).toBeLessThan(500)
    }
  })
})
