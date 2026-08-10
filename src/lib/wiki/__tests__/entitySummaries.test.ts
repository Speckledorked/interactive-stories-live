// src/lib/wiki/__tests__/entitySummaries.test.ts
// #167/#168: WikiEntry.summary must be a short, genuinely CURRENT line —
// distinct from description and regenerated every sync, not a frozen
// snapshot of whatever text seeded description at creation.

import { describe, it, expect } from 'vitest'
import {
  buildNpcWikiSummary,
  buildFactionWikiSummary,
  buildClockWikiSummary,
  buildLocationWikiSummary,
  buildQuestWikiSummary,
  buildItemWikiSummary,
} from '../entitySummaries'

describe('buildNpcWikiSummary', () => {
  it('leads with relationship stance and current plan when both are known', () => {
    const summary = buildNpcWikiSummary({ relationship: 'Friendly', currentPlan: 'Gathering allies against the Black Banner', goals: 'Reclaim the throne' })
    expect(summary).toBe('Friendly toward the party. Currently: Gathering allies against the Black Banner')
  })

  it('falls back to goals when there is no active plan', () => {
    const summary = buildNpcWikiSummary({ relationship: 'Hostile', currentPlan: null, goals: 'Destroy the party' })
    expect(summary).toBe('Hostile toward the party. Currently: Destroy the party')
  })

  it('defaults relationship to Neutral and omits the activity clause when nothing is known', () => {
    expect(buildNpcWikiSummary({})).toBe('Neutral toward the party.')
  })
})

describe('buildFactionWikiSummary', () => {
  it('reports qualitative bands for resources/stability/military, not raw numbers', () => {
    const summary = buildFactionWikiSummary({ resources: 90, stability: 10, military: 50, goal: 'control the trade routes' })
    expect(summary).not.toMatch(/\b90\b|\b10\b|\b50\b/)
    expect(summary).toMatch(/pursuing control the trade routes/)
  })
})

describe('buildClockWikiSummary', () => {
  it('includes live progress alongside the flavor description', () => {
    expect(buildClockWikiSummary({ currentTicks: 3, maxTicks: 8, description: 'The siege tightens' })).toBe('The siege tightens (3/8 ticks)')
  })

  it('falls back to bare progress when there is no description', () => {
    expect(buildClockWikiSummary({ currentTicks: 1, maxTicks: 4, description: null })).toBe('1/4 ticks')
  })
})

describe('buildLocationWikiSummary', () => {
  it('leads with the location type when known', () => {
    expect(buildLocationWikiSummary({ locationType: 'Tavern', description: 'A rowdy dockside haunt' })).toBe('Tavern — A rowdy dockside haunt')
  })

  it('falls back to bare description when there is no type', () => {
    expect(buildLocationWikiSummary({ locationType: null, description: 'A quiet clearing' })).toBe('A quiet clearing')
  })
})

describe('buildQuestWikiSummary', () => {
  it('pairs a human-readable status with the objective', () => {
    expect(buildQuestWikiSummary({ status: 'ACTIVE', objective: 'Find the missing envoy' })).toBe('In progress — Find the missing envoy')
  })

  it('title-cases non-active statuses', () => {
    expect(buildQuestWikiSummary({ status: 'COMPLETED', objective: 'Find the missing envoy' })).toBe('Completed — Find the missing envoy')
  })
})

describe('buildItemWikiSummary', () => {
  it('takes only the first line of a multi-line description', () => {
    expect(buildItemWikiSummary('A curved dagger.\n\nCarried by: Kess')).toBe('A curved dagger.')
  })
})
