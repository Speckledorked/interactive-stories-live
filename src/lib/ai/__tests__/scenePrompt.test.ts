// src/lib/ai/__tests__/scenePrompt.test.ts
//
// #115: outcome-band-driven narration pacing. buildOutcomeBandSection
// itself isn't exported (matches this file's own convention — only
// buildSystemPrompt/buildUserPrompt are), so it's exercised through
// buildSystemPrompt's actual output, the same way a real caller would see it.

import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildUserPrompt } from '../scenePrompt'
import type { AIGMRequest } from '../client'
import type { ActionMechanics } from '@/lib/game/resolution'

function makeRequest(actionMechanics: Partial<ActionMechanics>[] = []): AIGMRequest {
  return {
    campaign_universe: 'Test Universe',
    ai_system_prompt: 'Be a good GM.',
    action_mechanics: actionMechanics as ActionMechanics[],
  } as unknown as AIGMRequest
}

function mechanic(outcome: ActionMechanics['outcome']): Partial<ActionMechanics> {
  return { characterId: 'char-1', characterName: 'Kess', outcome }
}

describe('buildSystemPrompt — outcome-band pacing (#115)', () => {
  it('omits the section entirely when no roll happened this exchange', () => {
    const prompt = buildSystemPrompt(makeRequest([]))
    expect(prompt).not.toContain('<outcome_band_pacing>')
  })

  it('omits the section when action_mechanics is undefined', () => {
    const request = { campaign_universe: 'Test', ai_system_prompt: 'x' } as unknown as AIGMRequest
    expect(buildSystemPrompt(request)).not.toContain('<outcome_band_pacing>')
  })

  it('includes strong-hit pacing guidance for a clean success', () => {
    const prompt = buildSystemPrompt(makeRequest([mechanic('strongHit')]))
    expect(prompt).toContain('<outcome_band_pacing>')
    expect(prompt).toContain('clean, unqualified success')
  })

  it('includes weak-hit pacing guidance for a success with a cost', () => {
    const prompt = buildSystemPrompt(makeRequest([mechanic('weakHit')]))
    expect(prompt).toContain('success with a real cost')
  })

  it('includes miss pacing guidance for a setback', () => {
    const prompt = buildSystemPrompt(makeRequest([mechanic('miss')]))
    expect(prompt).toContain('genuine setback')
  })

  it('paces the whole exchange as a miss when any action missed, even if others succeeded', () => {
    const prompt = buildSystemPrompt(makeRequest([mechanic('strongHit'), mechanic('miss'), mechanic('weakHit')]))
    expect(prompt).toContain('genuine setback')
    expect(prompt).not.toContain('clean, unqualified success')
  })
})

describe('buildSystemPrompt — second-person narrative voice for solo scenes', () => {
  function makeRequestWithCharacters(characterCount: number): AIGMRequest {
    return {
      campaign_universe: 'Test Universe',
      ai_system_prompt: 'Be a good GM.',
      world_summary: {
        characters: Array.from({ length: characterCount }, (_, i) => ({ id: `char-${i}`, name: `PC ${i}` })),
      },
    } as unknown as AIGMRequest
  }

  it('addresses the player in second person when exactly one PC is in the scene', () => {
    const prompt = buildSystemPrompt(makeRequestWithCharacters(1))
    expect(prompt).toContain('<narrative_voice>')
    expect(prompt).toMatch(/second person/i)
  })

  it('omits the section for a multi-PC scene, staying third-person-by-name', () => {
    const prompt = buildSystemPrompt(makeRequestWithCharacters(3))
    expect(prompt).not.toContain('<narrative_voice>')
  })

  it('omits the section when there are zero characters (nothing to be solo about)', () => {
    const prompt = buildSystemPrompt(makeRequestWithCharacters(0))
    expect(prompt).not.toContain('<narrative_voice>')
  })

  it('does not throw and omits the section when world_summary is entirely absent from the request', () => {
    const request = { campaign_universe: 'Test', ai_system_prompt: 'x' } as unknown as AIGMRequest
    expect(() => buildSystemPrompt(request)).not.toThrow()
    expect(buildSystemPrompt(request)).not.toContain('<narrative_voice>')
  })
})

describe('buildSystemPrompt — outcome_echo appears in the response template, not just prose', () => {
  // The model was consistently omitting outcome_echo from real responses.
  // Root cause: <response_format>'s example JSON — the literal structure
  // the model is told it "MUST" match — never included the field; it was
  // only described in a paragraph of prose elsewhere in the prompt. A
  // field that's explained but never demonstrated in the example template
  // is exactly the kind of thing a model reliably drops. This pins the
  // fix: the field must be present in the actual example object, not just
  // mentioned in <mechanical_outcomes>.
  it('includes outcome_echo in the <response_format> example structure', () => {
    const prompt = buildSystemPrompt(makeRequest([]))
    const responseFormatSection = prompt.slice(
      prompt.indexOf('<response_format>'),
      prompt.indexOf('</response_format>')
    )
    expect(responseFormatSection).toContain('"outcome_echo"')
  })
})

describe('buildSystemPrompt — consequences (promises/enemies/threats) get call-back-and-resolve guidance', () => {
  // Debts and quests both had explicit "bring it back, then resolve it"
  // instructions; promises/enemies/longTermThreats had none at all beyond
  // a bare JSON field example, so they tended to only ever accumulate.
  it('tells the model to call back an open consequence before it resolves it', () => {
    const prompt = buildSystemPrompt(makeRequest([]))
    expect(prompt).toMatch(/CALL BACK/i)
  })

  it('tells the model to resolve a consequence the story has moved past, not leave it stale', () => {
    const prompt = buildSystemPrompt(makeRequest([]))
    expect(prompt).toMatch(/consequences_remove/i)
    expect(prompt).toMatch(/no longer relevant|no longer live|moved on/i)
  })
})

describe('buildSystemPrompt — long-scene pacing pressure', () => {
  // A player reported: "I keep saying 'I comply' to move things along and
  // it's just more of the same." Root cause: the narrator only ever sees
  // its last 2 exchanges of prose, so nothing told it a scene had run long
  // enough to be stuck in a loop of manufactured complications.
  function makeRequestWithExchange(exchangeNumber: number): AIGMRequest {
    return {
      campaign_universe: 'Test Universe',
      ai_system_prompt: 'Be a good GM.',
      current_exchange_number: exchangeNumber,
    } as unknown as AIGMRequest
  }

  it('omits <pacing> for a short scene', () => {
    const prompt = buildSystemPrompt(makeRequestWithExchange(3))
    expect(prompt).not.toContain('<pacing>')
  })

  it('omits <pacing> when current_exchange_number is absent from the request', () => {
    const request = { campaign_universe: 'Test', ai_system_prompt: 'x' } as unknown as AIGMRequest
    expect(buildSystemPrompt(request)).not.toContain('<pacing>')
  })

  it('nudges toward resolution once a scene crosses the first threshold', () => {
    const prompt = buildSystemPrompt(makeRequestWithExchange(8))
    expect(prompt).toContain('<pacing>')
    expect(prompt).toMatch(/let the current thread genuinely resolve/i)
  })

  it('escalates to an urgent resolve-now instruction well past the threshold', () => {
    const prompt = buildSystemPrompt(makeRequestWithExchange(15))
    expect(prompt).toMatch(/unusually long/i)
    expect(prompt).toMatch(/Resolve this now/i)
  })

  // A soft, conditional urgent tier ("if the player has really earned it,
  // that has to work now") still let the model route around resolving —
  // a real report of staying stuck well past this threshold. The fix
  // mirrors the same soft-guidance-to-hard-requirement shape already
  // proven necessary elsewhere in this file (stat_labels canon reuse).
  it('makes the urgent tier an unconditional rule, not a judgment call', () => {
    const prompt = buildSystemPrompt(makeRequestWithExchange(15))
    expect(prompt).toMatch(/HARD REQUIREMENT/i)
    expect(prompt).toMatch(/not permitted/i)
    // The old urgent-tier wording gated resolution on "if the player has
    // been cooperating" — a hedge the model could (and did) disagree
    // with to justify one more complication. That conditional framing
    // must be gone at this tier now, not just supplemented.
    expect(prompt).not.toMatch(/If the player has been cooperating/i)
  })
})

describe('buildSystemPrompt — scene ending signal (definitive end-scene)', () => {
  function makeEndingRequest(isSceneEnding?: boolean, stakes?: string | null): AIGMRequest {
    return {
      campaign_universe: 'Test Universe',
      ai_system_prompt: 'Be a good GM.',
      is_scene_ending: isSceneEnding,
      scene_stakes: stakes,
    } as unknown as AIGMRequest
  }

  it('omits <scene_ending> when is_scene_ending is absent', () => {
    const request = { campaign_universe: 'Test', ai_system_prompt: 'x' } as unknown as AIGMRequest
    expect(buildSystemPrompt(request)).not.toContain('<scene_ending>')
  })

  it('omits <scene_ending> when is_scene_ending is explicitly false', () => {
    const prompt = buildSystemPrompt(makeEndingRequest(false))
    expect(prompt).not.toContain('<scene_ending>')
  })

  it('includes an unconditional hard-requirement instruction when is_scene_ending is true', () => {
    const prompt = buildSystemPrompt(makeEndingRequest(true))
    expect(prompt).toContain('<scene_ending>')
    expect(prompt).toMatch(/FINAL exchange/i)
    expect(prompt).toMatch(/HARD REQUIREMENT/i)
    expect(prompt).toMatch(/not permitted/i)
  })

  it('references scene_stakes when present', () => {
    const prompt = buildSystemPrompt(makeEndingRequest(true, 'The last bridge out of the city collapses if they fail.'))
    expect(prompt).toContain('The last bridge out of the city collapses if they fail.')
  })

  it('does not reference stakes text when scene_stakes is absent', () => {
    const prompt = buildSystemPrompt(makeEndingRequest(true, null))
    const section = prompt.slice(prompt.indexOf('<scene_ending>'), prompt.indexOf('</scene_ending>'))
    expect(section).not.toMatch(/stakes established/i)
  })
})

describe('buildSystemPrompt — storytelling rules allow a genuine resolution, not only new problems', () => {
  it('no longer mandates a new problem/decision point as the only valid ending', () => {
    const prompt = buildSystemPrompt(makeRequest([]))
    expect(prompt).toMatch(/forward progress/i)
    expect(prompt).toMatch(/resolution as often as it is a new problem/i)
  })
})

describe('buildSystemPrompt — player action text is not treated as literal dialogue', () => {
  // A submitted action like "I go along with the questioning because I'm
  // bored" mixes the in-fiction action with the player's own real-world
  // reason for choosing it. The model was voicing that reasoning as if the
  // character said it out loud. Root cause: <player_character_control>'s
  // old "IF THE PLAYER SAID IT: quote it exactly" rule gave no way to
  // distinguish in-character dialogue from an out-of-character aside.
  it('tells the model an out-of-character aside within an action is not something the character says', () => {
    const prompt = buildSystemPrompt(makeRequest([]))
    expect(prompt).toMatch(/out-of-character/i)
    expect(prompt).toMatch(/because I'm bored/i)
  })

  it('only treats explicit written dialogue as quotable, not the whole submitted action', () => {
    const prompt = buildSystemPrompt(makeRequest([]))
    expect(prompt).toMatch(/PLAYER WROTE ACTUAL DIALOGUE/i)
  })
})

describe('buildUserPrompt — player actions are not quote-wrapped like dialogue', () => {
  // Presenting the whole action as `Name: "text"` visually primed the
  // model to treat it as a spoken line, reinforcing the same bug the
  // system-prompt fix above addresses from the other direction.
  function makeActionRequest(actionText: string): AIGMRequest {
    return {
      world_summary: {
        turn_number: 1,
        in_game_date: 'Day 1',
        characters: [], npcs: [], factions: [], clocks: [], recent_timeline_events: [],
      },
      current_scene_intro: 'The room is quiet.',
      player_actions: [{ character_name: 'Kess', action_text: actionText }],
    } as unknown as AIGMRequest
  }

  it('presents the action without wrapping it in quotes like a dialogue line', () => {
    const prompt = buildUserPrompt(makeActionRequest("I go along with the questioning because I'm bored"))
    expect(prompt).toContain("Kess's submitted action: I go along with the questioning because I'm bored")
    expect(prompt).not.toContain('Kess: "')
  })
})

describe('buildUserPrompt — season in the world_state line (#118)', () => {
  function makeUserRequest(season?: string): AIGMRequest {
    return {
      world_summary: {
        turn_number: 12,
        in_game_date: '5 Harvestmoon, Year 2',
        season,
        characters: [], npcs: [], factions: [], clocks: [], recent_timeline_events: [],
      },
      current_scene_intro: 'The market is quiet.',
      player_actions: [],
    } as unknown as AIGMRequest
  }

  it('includes the season alongside turn/date when present', () => {
    const prompt = buildUserPrompt(makeUserRequest('Winter'))
    expect(prompt).toContain('Turn: 12 | Date: 5 Harvestmoon, Year 2 | Season: Winter')
  })

  it('omits the season segment entirely when absent, rather than printing "undefined"', () => {
    const prompt = buildUserPrompt(makeUserRequest(undefined))
    expect(prompt).toContain('Turn: 12 | Date: 5 Harvestmoon, Year 2')
    expect(prompt).not.toContain('Season:')
    expect(prompt).not.toContain('undefined')
  })
})
