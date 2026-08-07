// src/lib/ai/__tests__/askGm.test.ts
// Ask-the-GM: pure prompt building. buildAskGmPrompt is the only piece of
// generateGmAnswer that doesn't touch the DB/network, so it's what gets a
// direct unit test — the orchestration around it is exercised end-to-end
// via the API route instead (see the "no PlayerAction" architectural
// constraint documented on the GmClarification model).

import { describe, it, expect } from 'vitest'
import { buildAskGmPrompt } from '../askGm'

describe('buildAskGmPrompt', () => {
  const baseCtx = {
    campaignTitle: 'The Sundered Veil',
    universe: 'He Who Fights With Monsters',
    characterName: 'Helios',
    characterSummary: { id: 'char1', capabilities: { known: [] } },
    sceneText: 'The allomancer squares up, coins glinting in his palm.',
    question: 'What can I see on his person?',
    relevantLore: [],
  }

  it('tells the model this is not a turn — no dice, no consequences, no reactions', () => {
    const { system } = buildAskGmPrompt(baseCtx)
    expect(system).toMatch(/not a turn/i)
    expect(system).toMatch(/no dice/i)
    expect(system).toMatch(/no NPC reactions/i)
    expect(system).toMatch(/no time passing/i)
  })

  it('instructs honesty over invention when the character would not know', () => {
    const { system } = buildAskGmPrompt(baseCtx)
    expect(system).toMatch(/never invent information/i)
  })

  it('includes the character name, scene text, knowledge, and question in the user prompt', () => {
    const { user } = buildAskGmPrompt(baseCtx)
    expect(user).toContain('Helios')
    expect(user).toContain('The Sundered Veil')
    expect(user).toContain('He Who Fights With Monsters')
    expect(user).toContain('The allomancer squares up')
    expect(user).toContain('What can I see on his person?')
    expect(user).toContain('"id": "char1"')
  })

  it('falls back to a placeholder when there is no scene text yet', () => {
    const { user } = buildAskGmPrompt({ ...baseCtx, sceneText: '' })
    expect(user).toContain('(no scene text yet)')
  })

  it('is deterministic for the same input (no randomness in prompt construction)', () => {
    expect(buildAskGmPrompt(baseCtx)).toEqual(buildAskGmPrompt(baseCtx))
  })

  it('omits the lore block entirely when nothing relevant was retrieved', () => {
    const { user } = buildAskGmPrompt(baseCtx)
    expect(user).not.toContain('CAMPAIGN LORE')
  })

  it('includes retrieved lore as canon, and tells the model to answer setting-wide questions from it directly', () => {
    const { system, user } = buildAskGmPrompt({
      ...baseCtx,
      relevantLore: [{ title: 'Guidance Systems', content: 'Every being in this universe has an intuitive guidance system.' }],
    })
    expect(user).toContain('CAMPAIGN LORE')
    expect(user).toContain('Guidance Systems')
    expect(user).toContain('Every being in this universe has an intuitive guidance system.')
    expect(system).toMatch(/how does .* actually work/i)
    expect(system).toMatch(/established fact/i)
  })
})
