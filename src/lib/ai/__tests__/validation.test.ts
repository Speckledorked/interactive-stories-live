// src/lib/ai/__tests__/validation.test.ts
// Phase 15: Tests for AI response validation and fallback system

import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { validateAIResponse, validateAIResponseWithRepair, buildRepairPrompt, validateWorldTurnResponse } from '../validation'

describe('AI Response Validation (Phase 15)', () => {
  describe('Full Schema Validation', () => {
    it('should validate a complete valid AI response', () => {
      const validResponse = {
        scene_text: 'The heroes burst through the door, weapons drawn. The villain turns to face them with a cruel smile.',
        world_updates: {
          pc_changes: [
            {
              character_name_or_id: 'character_123',
              changes: {
                harm_damage: 2,
                location: 'Villain\'s Lair'
              }
            }
          ],
          clock_changes: [
            {
              clock_name_or_id: 'doomsday_clock',
              delta: 1
            }
          ]
        }
      }

      const result = validateAIResponse(validResponse)

      if (!result.success) throw new Error('Expected validation to succeed')
      expect(result.level).toBe('full')
      if (result.success) {
        expect(result.data.scene_text).toBe(validResponse.scene_text)
      }
    })

    it('should validate response with relationship changes', () => {
      const validResponse = {
        scene_text: 'The guard captain nods appreciatively at your bravery.',
        world_updates: {
          pc_changes: [
            {
              character_name_or_id: 'hero_001',
              changes: {
                relationship_changes: [
                  {
                    entity_id: 'guard_captain',
                    entity_name: 'Captain Ironbeard',
                    trust_delta: 10,
                    respect_delta: 5,
                    reason: 'Character saved the captain\'s life'
                  }
                ]
              }
            }
          ]
        }
      }

      const result = validateAIResponse(validResponse)

      if (!result.success) throw new Error('Expected validation to succeed')
      expect(result.level).toBe('full')
    })

    it('should validate response with consequences', () => {
      const validResponse = {
        scene_text: 'You promise the merchant you\'ll return with the stolen goods.',
        world_updates: {
          pc_changes: [
            {
              character_name_or_id: 'hero_001',
              changes: {
                consequences_add: [
                  {
                    type: 'promise',
                    description: 'Promised to return stolen goods to the merchant'
                  }
                ]
              }
            }
          ]
        }
      }

      const result = validateAIResponse(validResponse)

      if (!result.success) throw new Error('Expected validation to succeed')
      expect(result.level).toBe('full')
    })
  })

  describe('Partial Validation (Progressive Fallback)', () => {
    it('should extract scene_text even when world_updates are malformed', () => {
      const partialResponse = {
        scene_text: 'The battle continues with intensity and uncertainty.',
        world_updates: 'invalid' // Invalid format
      }

      const result = validateAIResponse(partialResponse)

      if (!result.success) throw new Error('Expected validation to succeed')
      expect(result.level).toBe('partial')
      if (result.success) {
        expect(result.data.scene_text).toBe(partialResponse.scene_text)
        expect(result.data.world_updates).toEqual({}) // Empty updates
      }
    })

    it('should handle missing world_updates', () => {
      const partialResponse = {
        scene_text: 'You hear footsteps approaching from the shadows.'
      }

      const result = validateAIResponse(partialResponse)

      if (!result.success) throw new Error('Expected validation to succeed')
      expect(result.level).toBe('partial')
    })
  })

  describe('Emergency Fallback', () => {
    it('should use emergency template when scene_text is too short', () => {
      const invalidResponse = {
        scene_text: 'Hi',
        world_updates: {}
      }

      const result = validateAIResponse(invalidResponse)

      if (!result.success) throw new Error('Expected validation to succeed')
      expect(result.level).toBe('emergency')
      if (result.success) {
        expect(result.data.scene_text.length).toBeGreaterThan(50)
        expect(result.data.scene_text).toContain('AI GM temporarily unavailable')
      }
    })

    it('should use emergency template for completely invalid response', () => {
      const invalidResponse = {
        invalid: 'structure',
        no_scene_text: true
      }

      const result = validateAIResponse(invalidResponse)

      if (!result.success) throw new Error('Expected validation to succeed')
      expect(result.level).toBe('emergency')
    })

    it('should select appropriate emergency template based on context', () => {
      const invalidResponse = {}

      const combatResult = validateAIResponse(invalidResponse, 'The party attacks the dragon in combat')
      if (!combatResult.success) throw new Error('Expected validation to succeed')
      expect(combatResult.level).toBe('emergency')
      if (combatResult.success) {
        expect(combatResult.data.scene_text.toLowerCase()).toContain('battle')
      }

      const socialResult = validateAIResponse(invalidResponse, 'The player tries to talk and persuade the guard')
      if (!socialResult.success) throw new Error('Expected validation to succeed')
      expect(socialResult.level).toBe('emergency')
      if (socialResult.success) {
        expect(socialResult.data.scene_text.toLowerCase()).toMatch(/conversation|talk/)
      }
    })
  })

  describe('Loose Extraction', () => {
    it('should extract text from various field names', () => {
      const variants = [
        { sceneText: 'Text with different field name' },
        { narrative: 'Text in narrative field' },
        { description: 'Text in description field' }
      ]

      variants.forEach(variant => {
        const result = validateAIResponse(variant)
        if (!result.success) throw new Error('Expected validation to succeed')
        expect(result.level).toBe('partial')
      })
    })

    it('should handle plain string response', () => {
      const plainString = 'This is just a plain string response from AI'

      const result = validateAIResponse(plainString)

      if (!result.success) throw new Error('Expected validation to succeed')
      expect(result.level).toBe('partial')
    })
  })

  describe('Edge Cases', () => {
    it('should handle null response', () => {
      const result = validateAIResponse(null)

      if (!result.success) throw new Error('Expected validation to succeed')
      expect(result.level).toBe('emergency')
    })

    it('should handle empty object', () => {
      const result = validateAIResponse({})

      if (!result.success) throw new Error('Expected validation to succeed')
      expect(result.level).toBe('emergency')
    })

    it('should validate harm values within range', () => {
      const validHarm = {
        scene_text: 'You take a glancing blow from the sword. The blade cuts across your arm, drawing blood, but you manage to stay on your feet.',
        world_updates: {
          pc_changes: [
            {
              character_name_or_id: 'hero_001',
              changes: {
                harm_damage: 2 // Valid: 0-6
              }
            }
          ]
        }
      }

      const result = validateAIResponse(validHarm)
      if (!result.success) throw new Error('Expected validation to succeed')
      expect(result.level).toBe('full')
    })

    it('should reject harm values outside valid range', () => {
      const invalidHarm = {
        scene_text: 'You take massive damage.',
        world_updates: {
          pc_changes: [
            {
              character_name_or_id: 'hero_001',
              changes: {
                harm_damage: 10 // Invalid: exceeds max of 6
              }
            }
          ]
        }
      }

      const result = validateAIResponse(invalidHarm)

      // Should fall back to partial (scene_text only)
      if (!result.success) throw new Error('Expected validation to succeed')
      expect(result.level).toBe('partial')
    })
  })
})

describe('buildRepairPrompt', () => {
  it('names the specific structural problems, capped at 8', () => {
    const { error } = z.object({ a: z.string(), b: z.string() }).safeParse({ a: 1, b: 2 }) as { error: z.ZodError }
    const prompt = buildRepairPrompt(error)
    expect(prompt).toContain('a:')
    expect(prompt).toContain('b:')
    expect(prompt).toContain('Respond with JSON only')
  })
})

describe('validateAIResponseWithRepair (depth-hardening #36)', () => {
  const validResponse = {
    scene_text: 'The heroes burst through the door, weapons drawn. The villain turns to face them with a cruel smile.',
    world_updates: { pc_changes: [{ character_name_or_id: 'character_123', changes: { harm_damage: 2 } }] },
  }
  const invalidResponse = {
    scene_text: 'You take massive damage.',
    world_updates: { pc_changes: [{ character_name_or_id: 'hero_001', changes: { harm_damage: 10 } }] },
  }

  it('returns full immediately without calling repair when the first attempt already validates', async () => {
    const repair = vi.fn()
    const result = await validateAIResponseWithRepair(validResponse, undefined, repair)
    expect(repair).not.toHaveBeenCalled()
    if (!result.success) throw new Error('Expected validation to succeed')
    expect(result.level).toBe('full')
  })

  it('calls repair with the specific errors and uses the corrected response when it now validates', async () => {
    const repair = vi.fn().mockResolvedValue(validResponse)
    const result = await validateAIResponseWithRepair(invalidResponse, undefined, repair)
    expect(repair).toHaveBeenCalledTimes(1)
    expect(repair.mock.calls[0][0]).toContain('harm_damage')
    if (!result.success) throw new Error('Expected validation to succeed')
    expect(result.level).toBe('full')
    expect(result.data.scene_text).toBe(validResponse.scene_text)
  })

  it('falls back to progressive degradation when the repair response still fails validation', async () => {
    const repair = vi.fn().mockResolvedValue(invalidResponse)
    const result = await validateAIResponseWithRepair(invalidResponse, undefined, repair)
    expect(repair).toHaveBeenCalledTimes(1)
    if (!result.success) throw new Error('Expected validation to succeed')
    expect(result.level).toBe('partial')
  })

  it('falls back to progressive degradation when the repair call itself throws', async () => {
    const repair = vi.fn().mockRejectedValue(new Error('network down'))
    const result = await validateAIResponseWithRepair(invalidResponse, undefined, repair)
    if (!result.success) throw new Error('Expected validation to succeed')
    expect(result.level).toBe('partial')
  })

  it('never calls repair more than once even when it keeps failing', async () => {
    const repair = vi.fn().mockResolvedValue({ scene_text: 'x' }) // still invalid (too short, no world_updates)
    await validateAIResponseWithRepair(invalidResponse, undefined, repair)
    expect(repair).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Background world-turn validation (#66)
// ---------------------------------------------------------------------------
// The world-turn call writes through the same applyWorldUpdates path scene
// resolution does, but used to return a bare JSON.parse with no schema at
// all. The key guarantee under test: a malformed state-mutating field never
// reaches the writer just because the narrative around it parsed.

describe('validateWorldTurnResponse (#66)', () => {
  const validEvent = { title: 'The Duke moves', summary_public: 'Rumors spread.', summary_gm: 'He bribed the guard.' }

  it('accepts a well-formed full response including world_updates', () => {
    const result = validateWorldTurnResponse({
      offscreen_events: [validEvent],
      gm_notes: 'Watch the Duke.',
      world_updates: {
        npc_changes: [{ npc_name_or_id: 'Duke', changes: { notes_append: 'bribed a guard' } }],
        faction_changes: [{ faction_name_or_id: 'Crown', changes: { threat_level: 'HIGH' } }],
      },
      ambition_picks: [{ faction_id: 'f1', category: 'tournament', name: 'The Ember Trials' }],
    })
    expect(result.level).toBe('full')
    if (result.level !== 'full') throw new Error('expected full')
    expect(result.data.offscreen_events).toHaveLength(1)
    expect(result.data.world_updates?.npc_changes).toHaveLength(1)
    expect(result.data.ambition_picks).toHaveLength(1)
  })

  it('defaults a missing summary_gm rather than failing the whole turn', () => {
    const result = validateWorldTurnResponse({
      offscreen_events: [{ title: 'A', summary_public: 'B' }],
      gm_notes: '',
    })
    expect(result.level).toBe('full')
    if (result.level !== 'full') throw new Error('expected full')
    expect(result.data.offscreen_events[0].summary_gm).toBe('')
  })

  it('degrades to narrative-only when world_updates is malformed, DROPPING the bad updates', () => {
    const result = validateWorldTurnResponse({
      offscreen_events: [validEvent],
      gm_notes: 'notes',
      world_updates: {
        // harm_damage is bounded 0-6 by NPCChangesSchema; 9000 must not reach the writer
        npc_changes: [{ npc_name_or_id: 'Duke', changes: { harm_damage: 9000 } }],
      },
    })
    expect(result.level).toBe('narrative')
    if (result.level !== 'narrative') throw new Error('expected narrative')
    expect(result.data.offscreen_events).toHaveLength(1)
    expect((result.data as any).world_updates).toBeUndefined()
  })

  it('drops ambition_picks too when the full parse fails', () => {
    const result = validateWorldTurnResponse({
      offscreen_events: [validEvent],
      world_updates: { faction_changes: [{ faction_name_or_id: 'X', changes: { threat_level: 'CATASTROPHIC' } }] },
      ambition_picks: [{ faction_id: 'f1', category: 'tournament', name: 'Valid Name' }],
    })
    expect(result.level).toBe('narrative')
    if (result.level !== 'narrative') throw new Error('expected narrative')
    expect((result.data as any).ambition_picks).toBeUndefined()
  })

  it('strips unknown keys instead of passing them through to the writer', () => {
    const result = validateWorldTurnResponse({
      offscreen_events: [validEvent],
      world_updates: { npc_changes: [{ npc_name_or_id: 'Duke', changes: { notes_append: 'ok' } }] },
      pc_changes: [{ character_name_or_id: 'hero', changes: { harm_damage: 6 } }], // not part of this contract
    })
    expect(result.level).toBe('full')
    if (result.level !== 'full') throw new Error('expected full')
    expect((result.data as any).pc_changes).toBeUndefined()
  })

  it('returns level "none" when nothing usable can be salvaged', () => {
    const result = validateWorldTurnResponse({ offscreen_events: 'not an array' })
    expect(result.level).toBe('none')
  })

  it('treats an empty object as a valid empty turn (all fields optional)', () => {
    const result = validateWorldTurnResponse({})
    expect(result.level).toBe('full')
    if (result.level !== 'full') throw new Error('expected full')
    expect(result.data.offscreen_events).toEqual([])
    expect(result.data.gm_notes).toBe('')
  })
})
