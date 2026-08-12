import { describe, it, expect } from 'vitest'
import { applyTokenBudget, DEFAULT_TOKEN_BUDGET } from '../tokenBudget'
import { estimateTokenCount } from '../cost-tracker'
import type { AIGMRequest } from '../client'

type WorldSummary = AIGMRequest['world_summary']

const bigText = (n: number) => 'x'.repeat(n)

function makeCharacter(id: string, name: string) {
  return {
    id, name,
    description: null, appearance: null, personality: null,
    stats: {}, backstory: null, goals: null, location: null,
  } as WorldSummary['characters'][number]
}

function makeWorldSummary(overrides: Partial<WorldSummary> = {}): WorldSummary {
  return {
    turn_number: 5,
    in_game_date: 'Day 5',
    characters: [makeCharacter('c1', 'Alice'), makeCharacter('c2', 'Bob')],
    npcs: [],
    factions: [],
    clocks: [],
    recent_timeline_events: [],
    ...overrides,
  } as WorldSummary
}

function estimate(worldSummary: WorldSummary, currentSceneIntro: string): number {
  return estimateTokenCount(JSON.stringify(worldSummary)) + estimateTokenCount(currentSceneIntro)
}

describe('applyTokenBudget', () => {
  it('returns the input completely unchanged when already under budget', () => {
    const worldSummary = makeWorldSummary()
    const result = applyTokenBudget({ worldSummary, currentSceneIntro: 'A short intro.', participantCharacterIds: null })
    expect(result.stepsApplied).toEqual([])
    expect(result.worldSummary).toBe(worldSummary)
    expect(result.currentSceneIntro).toBe('A short intro.')
  })

  it('trims relevant_lore first when barely over budget', () => {
    const worldSummary = makeWorldSummary({
      relevant_lore: [{ title: 'Lore', content: bigText(2000), relevance: '90%' }],
    })
    const over = estimate(worldSummary, '')
    const result = applyTokenBudget({ worldSummary, currentSceneIntro: '', participantCharacterIds: null }, over - 10)
    expect(result.stepsApplied).toEqual(['relevant_lore'])
    expect(result.worldSummary.relevant_lore).toEqual([])
  })

  it('trims lore, history, and campaign summary in priority order before ever touching characters', () => {
    const worldSummary = makeWorldSummary({
      relevant_lore: [{ title: 'Lore', content: bigText(1000), relevance: '90%' }],
      relevant_campaign_history: [{ turn: 1, title: 'T', summary: bigText(1000), type: 'x', importance: 'NORMAL', emotional_tone: null, relevance: '90%' }],
      _campaignSummary: bigText(1000),
    })
    // Everything else in the fixture (characters, empty npcs/factions/etc.)
    // is exactly what makeWorldSummary() alone produces, so this is the
    // real floor once all three full-clear steps have fired.
    const bareSize = estimate(makeWorldSummary(), '')
    const result = applyTokenBudget({ worldSummary, currentSceneIntro: '', participantCharacterIds: null }, bareSize + 50)

    expect(result.stepsApplied).toEqual(['relevant_lore', 'relevant_campaign_history', '_campaignSummary'])
    expect(result.worldSummary.characters).toHaveLength(2)
    expect(estimate(result.worldSummary, '')).toBeLessThanOrEqual(bareSize + 50)
  })

  it('trims current_scene_intro only after tier 1 is exhausted', () => {
    const worldSummary = makeWorldSummary()
    const currentSceneIntro = bigText(4000)
    const bare = estimate(worldSummary, '')
    // Budget below the intro's own size but above the bare world summary —
    // tier 1 has nothing to give (no lore/history/etc.), so tier 2 must fire.
    const result = applyTokenBudget({ worldSummary, currentSceneIntro, participantCharacterIds: null }, bare + 100)
    expect(result.stepsApplied).toEqual(['current_scene_intro'])
    expect(result.currentSceneIntro.length).toBeLessThan(currentSceneIntro.length)
  })

  it('keeps the END of current_scene_intro, not the start, when trimming', () => {
    // sceneResolutionRequest.ts builds this as [scene framing] + "What Has
    // Happened Recently" + [last two exchanges, oldest first]. The most
    // recent exchange is always at the very end — cutting from the end
    // (like truncateWithEllipsis does) would throw away exactly the
    // continuity that stops the next exchange from re-narrating a beat
    // that just happened. This pins the fix: the tail must survive.
    const worldSummary = makeWorldSummary()
    const currentSceneIntro = 'STALE OPENING '.repeat(200) + 'FRESHEST EXCHANGE JUST NOW'
    const bare = estimate(worldSummary, '')
    const result = applyTokenBudget({ worldSummary, currentSceneIntro, participantCharacterIds: null }, bare + 100)
    expect(result.stepsApplied).toEqual(['current_scene_intro'])
    // The tail survives, and it's the trimmed input that grew a leading
    // '...' marker — proof the cut happened at the front, not the back.
    expect(result.currentSceneIntro.endsWith('FRESHEST EXCHANGE JUST NOW')).toBe(true)
    expect(result.currentSceneIntro.startsWith('...')).toBe(true)
    expect(result.currentSceneIntro.length).toBeLessThan(currentSceneIntro.length)
  })

  // #231: halving alone has no floor — on a pathological over-budget
  // request it could shrink current_scene_intro to a near-empty,
  // incoherent fragment rather than degrading gracefully.
  it('drops current_scene_intro entirely rather than halving it into a near-empty fragment', () => {
    const worldSummary = makeWorldSummary()
    // Short enough that halving (ceil(400/2) = 200) would land under the
    // 300-char floor — this must drop to '' rather than truncate to 200.
    const currentSceneIntro = bigText(400)
    const bare = estimate(worldSummary, '')
    const result = applyTokenBudget({ worldSummary, currentSceneIntro, participantCharacterIds: null }, bare + 10)
    expect(result.stepsApplied).toEqual(['current_scene_intro_dropped'])
    expect(result.currentSceneIntro).toBe('')
  })

  it('still halves (not drops) when the result would land at or above the floor', () => {
    const worldSummary = makeWorldSummary()
    // Halving (ceil(4000/2) = 2000) comfortably clears the 300-char floor.
    const currentSceneIntro = bigText(4000)
    const bare = estimate(worldSummary, '')
    const result = applyTokenBudget({ worldSummary, currentSceneIntro, participantCharacterIds: null }, bare + 100)
    expect(result.stepsApplied).toEqual(['current_scene_intro'])
    expect(result.currentSceneIntro.length).toBe(2003) // 2000 + '...' prefix
  })

  it('narrows characters to only the current scene\'s participants as the last, most-protected tier', () => {
    const worldSummary = makeWorldSummary({
      characters: [makeCharacter('c1', 'Alice'), makeCharacter('c2', 'Bob'), makeCharacter('c3', 'Carol')],
    })
    // Force it all the way to tier 3 by setting an impossibly tight budget.
    const result = applyTokenBudget(
      { worldSummary, currentSceneIntro: '', participantCharacterIds: ['c1'] },
      1
    )
    expect(result.stepsApplied).toContain('characters')
    expect(result.worldSummary.characters.map((c) => c.id)).toEqual(['c1'])
  })

  it('never touches characters for a genuinely open scene (participantCharacterIds null), even under an impossible budget', () => {
    const worldSummary = makeWorldSummary({
      characters: [makeCharacter('c1', 'Alice'), makeCharacter('c2', 'Bob')],
    })
    const result = applyTokenBudget({ worldSummary, currentSceneIntro: '', participantCharacterIds: null }, 1)
    expect(result.stepsApplied).not.toContain('characters')
    expect(result.worldSummary.characters).toHaveLength(2)
  })

  it('never narrows characters below the participant floor even if still over budget afterward', () => {
    const worldSummary = makeWorldSummary({
      characters: [makeCharacter('c1', 'Alice'), makeCharacter('c2', 'Bob')],
    })
    const result = applyTokenBudget(
      { worldSummary, currentSceneIntro: '', participantCharacterIds: ['c1', 'c2'] },
      1
    )
    // Both characters ARE the participants — nothing to narrow down to,
    // so the "onlyParticipants.length < worldSummary.characters.length"
    // guard correctly declines to touch it.
    expect(result.stepsApplied).not.toContain('characters')
    expect(result.worldSummary.characters).toHaveLength(2)
  })

  it('defaults to DEFAULT_TOKEN_BUDGET when no explicit budget is given', () => {
    const worldSummary = makeWorldSummary()
    const result = applyTokenBudget({ worldSummary, currentSceneIntro: 'short', participantCharacterIds: null })
    expect(estimate(worldSummary, 'short')).toBeLessThan(DEFAULT_TOKEN_BUDGET)
    expect(result.stepsApplied).toEqual([])
  })
})
