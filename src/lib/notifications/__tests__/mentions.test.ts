// src/lib/notifications/__tests__/mentions.test.ts
import { describe, it, expect } from 'vitest'
import { detectMentions } from '../mentions'

describe('detectMentions', () => {
  const members = [
    { userId: 'u1', name: 'Alice', email: 'alice@example.com' },
    { userId: 'u2', name: null, email: 'bob@example.com' },
    { userId: 'author', name: 'Author', email: 'author@example.com' },
  ]

  it('matches a mention by display name, case-insensitively', () => {
    expect(detectMentions('Hey @alice, check this out', members, 'author')).toEqual(['u1'])
  })

  it('falls back to the email local-part when a member has no name', () => {
    expect(detectMentions('cc @bob', members, 'author')).toEqual(['u2'])
  })

  it('never mentions the author of their own message', () => {
    expect(detectMentions('@author talking to myself', members, 'author')).toEqual([])
  })

  it('matches multiple distinct mentions', () => {
    const result = detectMentions('@alice and @bob should see this', members, 'author')
    expect(result.sort()).toEqual(['u1', 'u2'])
  })

  it('deduplicates repeated mentions of the same person', () => {
    expect(detectMentions('@alice @alice @alice', members, 'author')).toEqual(['u1'])
  })

  it('returns nothing when there is no @ at all', () => {
    expect(detectMentions('no mentions here', members, 'author')).toEqual([])
  })
})
