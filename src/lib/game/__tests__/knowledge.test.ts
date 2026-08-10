// src/lib/game/__tests__/knowledge.test.ts
// #173/#174: structured per-character knowledge, distinct from both
// conditions (temporary present-tense state) and the capability tree
// (system existence + proficiency).

import { describe, it, expect } from 'vitest'
import {
  createDefaultKnowledgeState,
  parseKnowledgeState,
  addKnownConcept,
  removeKnownConcept,
  MAX_KNOWN_CONCEPTS
} from '../knowledge'

describe('parseKnowledgeState', () => {
  it('gives a complete default state for a character who has never learned anything', () => {
    expect(parseKnowledgeState(null)).toEqual(createDefaultKnowledgeState())
    expect(parseKnowledgeState(undefined)).toEqual(createDefaultKnowledgeState())
  })

  it('survives the shapes a JSON column can actually hold', () => {
    for (const junk of ['nope', 42, [], true]) {
      expect(parseKnowledgeState(junk), String(junk)).toEqual(createDefaultKnowledgeState())
    }
  })

  it('reads a well-formed blob', () => {
    const state = parseKnowledgeState({
      concepts: [{ key: 'essences_exist', label: 'Essences exist', learnedAt: 3, source: 'Old Marta' }]
    })
    expect(state.concepts).toEqual([
      { key: 'essences_exist', label: 'Essences exist', learnedAt: 3, source: 'Old Marta' }
    ])
  })

  it('drops malformed entries rather than throwing', () => {
    const state = parseKnowledgeState({ concepts: [null, { key: 'ok' }, { label: 'missing key' }, 'string'] })
    expect(state.concepts).toEqual([])
  })
})

describe('addKnownConcept', () => {
  it('adds a new concept, keyed and lowercased', () => {
    const result = addKnownConcept([], { key: 'Essences_Exist', label: 'Essences exist' }, 5)
    expect(result).toEqual([{ key: 'essences_exist', label: 'Essences exist', learnedAt: 5, source: undefined }])
  })

  it('re-reporting the same key updates the label but keeps the original learnedAt', () => {
    const first = addKnownConcept([], { key: 'baron', label: "Something's off about the baron" }, 3)
    const second = addKnownConcept(first, { key: 'baron', label: 'The baron is secretly a vampire' }, 9)
    expect(second).toHaveLength(1)
    expect(second[0].label).toBe('The baron is secretly a vampire')
    expect(second[0].learnedAt).toBe(3)
  })

  it('is case-insensitive on the dedup key', () => {
    const first = addKnownConcept([], { key: 'ranks_exist', label: 'Ranks exist' }, 1)
    const second = addKnownConcept(first, { key: 'RANKS_EXIST', label: 'Ranks exist (confirmed)' }, 2)
    expect(second).toHaveLength(1)
  })

  it('ignores an empty/whitespace key', () => {
    expect(addKnownConcept([], { key: '  ', label: 'x' }, 1)).toEqual([])
  })

  it('is bounded, dropping the oldest entries', () => {
    let concepts: ReturnType<typeof addKnownConcept> = []
    for (let i = 0; i < MAX_KNOWN_CONCEPTS + 10; i++) {
      concepts = addKnownConcept(concepts, { key: `fact_${i}`, label: `Fact ${i}` }, i)
    }
    expect(concepts).toHaveLength(MAX_KNOWN_CONCEPTS)
    expect(concepts[0].key).toBe('fact_10')
    expect(concepts[concepts.length - 1].key).toBe(`fact_${MAX_KNOWN_CONCEPTS + 9}`)
  })
})

describe('removeKnownConcept', () => {
  it('removes by key, case-insensitively', () => {
    const concepts = addKnownConcept([], { key: 'wrong_fact', label: 'Something untrue' }, 1)
    expect(removeKnownConcept(concepts, 'WRONG_FACT')).toEqual([])
  })

  it('leaves the list untouched if the key is not present', () => {
    const concepts = addKnownConcept([], { key: 'real_fact', label: 'True thing' }, 1)
    expect(removeKnownConcept(concepts, 'nope')).toEqual(concepts)
  })
})
