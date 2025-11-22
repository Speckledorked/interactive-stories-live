// src/lib/ai/__tests__/validation.test.ts
// Phase 15: Tests for AI response validation and fallback system

import { describe, it, expect } from 'vitest'
import { validateAIResponse } from '../validation'

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

      expect(result.success).toBe(true)
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

      expect(result.success).toBe(true)
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

      expect(result.success).toBe(true)
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

      expect(result.success).toBe(true)
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

      expect(result.success).toBe(true)
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

      expect(result.success).toBe(true)
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

      expect(result.success).toBe(true)
      expect(result.level).toBe('emergency')
    })

    it('should select appropriate emergency template based on context', () => {
      const invalidResponse = {}

      const combatResult = validateAIResponse(invalidResponse, 'The party attacks the dragon in combat')
      expect(combatResult.success).toBe(true)
      expect(combatResult.level).toBe('emergency')
      if (combatResult.success) {
        expect(combatResult.data.scene_text.toLowerCase()).toContain('battle')
      }

      const socialResult = validateAIResponse(invalidResponse, 'The player tries to talk and persuade the guard')
      expect(socialResult.success).toBe(true)
      expect(socialResult.level).toBe('emergency')
      if (socialResult.success) {
        expect(combatResult.data.scene_text.toLowerCase()).toMatch(/conversation|talk/)
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
        expect(result.success).toBe(true)
        expect(result.level).toBe('partial')
      })
    })

    it('should handle plain string response', () => {
      const plainString = 'This is just a plain string response from AI'

      const result = validateAIResponse(plainString)

      expect(result.success).toBe(true)
      expect(result.level).toBe('partial')
    })
  })

  describe('Edge Cases', () => {
    it('should handle null response', () => {
      const result = validateAIResponse(null)

      expect(result.success).toBe(true)
      expect(result.level).toBe('emergency')
    })

    it('should handle empty object', () => {
      const result = validateAIResponse({})

      expect(result.success).toBe(true)
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
      expect(result.success).toBe(true)
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
      expect(result.success).toBe(true)
      expect(result.level).toBe('partial')
    })
  })
})
