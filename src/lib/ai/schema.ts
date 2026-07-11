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

// Equipment change schema
export const EquipmentChangeSchema = z.object({
  action: z.enum(['add', 'remove', 'replace']),
  value: z.string()
})

// Inventory item schema
export const InventoryItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  quantity: z.number(),
  tags: z.array(z.string())
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
    consequences_remove: z.array(z.string()).optional(),
    appearance_changes: z.object({
      description: z.string(),
      append: z.boolean().optional()
    }).optional(),
    personality_changes: z.object({
      description: z.string(),
      append: z.boolean().optional()
    }).optional(),
    equipment_changes: z.object({
      weapon: EquipmentChangeSchema.optional(),
      armor: EquipmentChangeSchema.optional(),
      misc: EquipmentChangeSchema.optional()
    }).optional(),
    inventory_changes: z.object({
      items_add: z.array(InventoryItemSchema).optional(),
      items_remove: z.array(z.string()).optional(),
      items_modify: z.array(z.object({
        id: z.string(),
        quantity_delta: z.number()
      })).optional(),
      slots_delta: z.number().optional()
    }).optional(),
    resource_changes: z.object({
      gold_delta: z.number().optional(),
      contacts_add: z.array(z.string()).optional(),
      contacts_remove: z.array(z.string()).optional(),
      reputation_changes: z.array(z.object({
        faction: z.string(),
        delta: z.number()
      })).optional()
    }).optional(),
    // Only meaningful once a character is Taken Out (harm 6) — see the
    // dying-state note in the prompt. Someone treating their wounds.
    medical_attention: z.object({
      skill: z.enum(['basic', 'trained', 'expert']),
      has_supplies: z.boolean()
    }).optional(),
    // Only meaningful while a character is in the critical "dying" state
    // (Taken Out with no stabilizing treatment yet). Narrate whether they
    // cling to life or slip further this turn.
    death_save_result: z.enum(['success', 'failure']).optional(),
    // A character's deliberate choice to die for something that matters.
    // Player-driven, not something to impose unprompted.
    heroic_sacrifice: z.object({
      circumstances: z.string(),
      effect: z.string()
    }).optional()
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
  is_new: z.boolean().optional(), // true when introducing a brand-new NPC mid-scene
  changes: z.object({
    description: z.string().optional(), // Short description for new NPCs
    notes_append: z.string().optional(),
    tags_add: z.array(z.string()).optional(),
    tags_remove: z.array(z.string()).optional(),
    // New or updated long-term goal. Set this for a new NPC's starting goal,
    // or to give an existing major NPC a fresh direction after their
    // previous goal completed (see the "goalCompleted" world event).
    goals: z.string().optional()
  })
})

// Faction changes schema
export const FactionChangesSchema = z.object({
  faction_name_or_id: z.string(),
  is_new: z.boolean().optional(), // true when introducing a brand-new faction mid-campaign
  changes: z.object({
    description: z.string().optional(), // Short description for new factions
    goals: z.string().optional(),       // Long-term goals for new factions
    current_plan: z.string().optional(),
    threat_level: z.enum(['LOW', 'MEDIUM', 'HIGH', 'EXTREME']).optional(),
    resources: z.record(z.any()).optional(),
    gm_notes_append: z.string().optional(),
    // World Sim Phase 6: the faction's simulation-tick goal. Only set this
    // when a scene has a player character directing a faction they lead
    // (Faction.leaderCharacterId) — for any other faction the deterministic
    // tick reassesses this automatically, and setting it here would just be
    // overwritten next turn.
    goal: z.enum(['EXPAND', 'DEFEND', 'ENRICH', 'DESTABILIZE_RIVAL', 'CONSOLIDATE']).optional()
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

// Location changes schema
export const LocationChangesSchema = z.object({
  name: z.string(),
  is_new: z.boolean().optional(),       // true when registering a new location
  description: z.string().optional(),   // what this place looks like / feels like
  location_type: z.string().optional(), // town, dungeon, wilderness, inn, building, etc.
  gm_notes_append: z.string().optional()
})

// World updates schema
export const WorldUpdatesSchema = z.object({
  new_timeline_events: z.array(TimelineEventSchema).optional(),
  clock_changes: z.array(ClockChangeSchema).optional(),
  npc_changes: z.array(NPCChangesSchema).optional(),
  pc_changes: z.array(PCChangesSchema).optional(),
  faction_changes: z.array(FactionChangesSchema).optional(),
  location_changes: z.array(LocationChangesSchema).optional(),
  organic_advancement: z.array(OrganicAdvancementSchema).optional(),
  notes_for_gm: z.string().optional()
})

// Time passage schema
export const TimePassageSchema = z.object({
  days: z.number().optional(),
  hours: z.number().optional(),
  new_date: z.string().optional(),
  description: z.string().optional()
})

// Full AI GM response schema
export const AIGMResponseSchema = z.object({
  scene_text: z.string().min(50, "Scene text must be at least 50 characters"),
  time_passage: TimePassageSchema.optional(),
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
