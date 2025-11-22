// src/lib/ai/schema.ts
// Zod schemas for strict AI output validation (Phase 15.1)

import { z } from 'zod'

/**
 * Phase 15.1: Strict Output Schema
 * Define comprehensive Zod schemas for all AI GM responses
 */

// Relationship change schema
export const RelationshipChangeSchema = z.object({
  entity_id: z.string(),
  entity_name: z.string(),
  trust_delta: z.number().optional(),
  tension_delta: z.number().optional(),
  respect_delta: z.number().optional(),
  fear_delta: z.number().optional(),
  reason: z.string()
})

// Consequence schemas
export const ConsequenceAddSchema = z.object({
  type: z.enum(['promise', 'debt', 'enemy', 'longTermThreat']),
  description: z.string()
})

// Condition schema
export const ConditionSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  category: z.enum(['Physical', 'Emotional', 'Special']),
  description: z.string(),
  mechanicalEffect: z.string().optional()
})

// PC changes schema
export const PCChangesSchema = z.object({
  character_name_or_id: z.string(),
  changes: z.object({
    harm_damage: z.number().min(0).max(6).optional(),
    harm_healing: z.number().min(0).max(6).optional(),
    conditions_add: z.array(ConditionSchema).optional(),
    conditions_remove: z.array(z.string()).optional(),
    location: z.string().optional(),
    relationship_changes: z.array(RelationshipChangeSchema).optional(),
    consequences_add: z.array(ConsequenceAddSchema).optional(),
    consequences_remove: z.array(z.string()).optional()
  })
})

// Timeline event schema
export const TimelineEventSchema = z.object({
  title: z.string(),
  summary_public: z.string(),
  summary_gm: z.string(),
  is_offscreen: z.boolean(),
  visibility: z.enum(['PUBLIC', 'GM_ONLY', 'MIXED'])
})

// Clock change schema
export const ClockChangeSchema = z.object({
  clock_name_or_id: z.string(),
  delta: z.number()
})

// NPC changes schema
export const NPCChangesSchema = z.object({
  npc_name_or_id: z.string(),
  changes: z.object({
    notes_append: z.string().optional(),
    tags_add: z.array(z.string()).optional(),
    tags_remove: z.array(z.string()).optional()
  })
})

// Faction changes schema
export const FactionChangesSchema = z.object({
  faction_name_or_id: z.string(),
  changes: z.object({
    current_plan: z.string().optional(),
    threat_level: z.enum(['LOW', 'MEDIUM', 'HIGH', 'EXTREME']).optional(),
    resources: z.record(z.any()).optional(),
    gm_notes_append: z.string().optional()
  })
})

// Organic advancement schemas
export const StatIncreaseSchema = z.object({
  stat_key: z.string(),
  delta: z.number(),
  reason: z.string()
})

export const PerkSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional()
})

export const OrganicAdvancementSchema = z.object({
  character_id: z.string(),
  stat_increases: z.array(StatIncreaseSchema).optional(),
  new_perks: z.array(PerkSchema).optional(),
  new_moves: z.array(z.string()).optional()
})

// World updates schema
export const WorldUpdatesSchema = z.object({
  new_timeline_events: z.array(TimelineEventSchema).optional(),
  clock_changes: z.array(ClockChangeSchema).optional(),
  npc_changes: z.array(NPCChangesSchema).optional(),
  pc_changes: z.array(PCChangesSchema).optional(),
  faction_changes: z.array(FactionChangesSchema).optional(),
  organic_advancement: z.array(OrganicAdvancementSchema).optional(),
  notes_for_gm: z.string().optional()
})

// Full AI GM response schema
export const AIGMResponseSchema = z.object({
  scene_text: z.string().min(50, "Scene text must be at least 50 characters"),
  world_updates: WorldUpdatesSchema
})

// Minimal fallback schema - just scene text
export const MinimalAIResponseSchema = z.object({
  scene_text: z.string().min(10, "Scene text must be at least 10 characters")
})

// Type exports for TypeScript
export type AIGMResponseValidated = z.infer<typeof AIGMResponseSchema>
export type MinimalAIResponse = z.infer<typeof MinimalAIResponseSchema>
export type WorldUpdates = z.infer<typeof WorldUpdatesSchema>
export type PCChanges = z.infer<typeof PCChangesSchema>
export type RelationshipChange = z.infer<typeof RelationshipChangeSchema>
export type OrganicAdvancement = z.infer<typeof OrganicAdvancementSchema>
