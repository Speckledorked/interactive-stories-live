// src/lib/ai/__tests__/worldState.test.ts
// scopeCharactersToParticipants is the one pure, DB-free piece of
// worldState.ts's split-party support (see its doc comment) — the rest of
// the file is a heavily Prisma-coupled orchestrator with no existing test
// coverage, consistent with this codebase's pure-function-first testing
// philosophy.

import { describe, it, expect } from 'vitest'
import { scopeCharactersToParticipants } from '../worldState'

const characters = [
  { id: 'a1', name: 'Aria' },
  { id: 'b2', name: 'Bram' },
  { id: 'c3', name: 'Coral' },
]

describe('scopeCharactersToParticipants', () => {
  it('returns only the listed characters when a non-empty participant list is given', () => {
    expect(scopeCharactersToParticipants(characters, ['b2'])).toEqual([{ id: 'b2', name: 'Bram' }])
  })

  it('preserves the original order and allows a multi-character list', () => {
    expect(scopeCharactersToParticipants(characters, ['c3', 'a1'])).toEqual([
      { id: 'a1', name: 'Aria' },
      { id: 'c3', name: 'Coral' },
    ])
  })

  it('returns the full roster for a null participant list (open scene)', () => {
    expect(scopeCharactersToParticipants(characters, null)).toEqual(characters)
  })

  it('returns the full roster for an undefined participant list', () => {
    expect(scopeCharactersToParticipants(characters, undefined)).toEqual(characters)
  })

  it('returns the full roster for an empty participant list', () => {
    expect(scopeCharactersToParticipants(characters, [])).toEqual(characters)
  })

  it('returns an empty array when the participant list matches no one', () => {
    expect(scopeCharactersToParticipants(characters, ['not-a-real-id'])).toEqual([])
  })
})
