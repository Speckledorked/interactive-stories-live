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
  mechanicalEffect: z.string().optional(),
  // Flat, universal roll modifier actually applied by computeMechanics
  // (see conditionPenalty in resolution.ts). Only set this for conditions
  // whose real effect is genuinely undirected — a bidirectional or
  // situational condition (e.g. "+1 combat/-2 social") should leave this
  // unset rather than force an inaccurate flat number.
  rollModifier: z.number().int().min(-2).max(2).optional()
})

// Equipment change schema
export const EquipmentChangeSchema = z.object({
  action: z.enum(['add', 'remove', 'replace']),
  value: z.string()
})

// A consumable item's mechanical payoff when used — see
// InventoryItem.effect's doc comment in lib/game/inventory.ts. 'heal' is
// the only kind the engine enforces (via resolveConsumableHeal); 'custom'
// is deliberately flavor-only.
export const InventoryItemEffectSchema = z.object({
  kind: z.enum(['heal', 'custom']),
  amount: z.number().min(0).max(6).optional(), // required for 'heal', ignored for 'custom'
  description: z.string()
})

// Inventory item schema
export const InventoryItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  quantity: z.number(),
  tags: z.array(z.string()),
  // Structured mechanical identity (depth-hardening #33 — see README): when
  // set, this is the exact armor reduction (0-3) the item grants, used in
  // place of guessing one from the name string — see
  // lib/game/inventory.ts's resolveArmorValue. Optional; most items (and
  // all non-armor items) simply omit it.
  armorValue: z.number().min(0).max(3).optional(),
  // Broad display categorization — purely informational, see
  // lib/game/inventory.ts's doc comment.
  itemType: z.enum(['weapon', 'armor', 'consumable', 'quest', 'currency', 'misc']).optional(),
  // Symmetric to armorValue, for weapons — see resolveDamageBonus.
  damageBonus: z.number().min(0).max(3).optional(),
  effect: InventoryItemEffectSchema.optional()
})

// Knowledge-relative capability change schema. The AI signals WHAT the
// fiction did (revealed / unlocked / meaningfully exercised a capability);
// deterministic server math decides what that's worth (see
// lib/game/capabilities.ts).
export const CapabilityChangeSchema = z.object({
  capability_key: z.string(),
  change: z.enum(['glimpse', 'unlock', 'progress']),
  is_new: z.boolean().optional(), // registers a brand-new capability node
  name: z.string().optional(), // display name when is_new
  domain: z.string().optional(), // grouping when is_new (e.g. "Essence Magic")
  framed_label: z.string().optional(), // the character's own vocabulary for it
  hint: z.string().optional(), // what a "???" sheet entry teases
  reason: z.string()
})

// Urban Shadows Debt economy: one owed favor between this PC and an
// NPC/faction, incurred or resolved by the fiction (see lib/game/debts.ts).
export const DebtChangeSchema = z.object({
  counterparty_name: z.string(),
  counterparty_type: z.enum(['npc', 'faction']),
  direction: z.enum(['owed_by_character', 'owed_to_character']),
  action: z.enum(['incur', 'resolve']),
  description: z.string(), // incur: what the favor was; resolve: how it ended
  reason: z.string()
})

// Urban Shadows faction standing: a social-position shift with a real
// simulated faction, earned by this scene (see lib/game/standing.ts —
// server clamps to ±1 per scene, bounds ±3).
export const StandingChangeSchema = z.object({
  faction_name: z.string(),
  delta: z.number(),
  reason: z.string()
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
    }).optional(),
    // Knowledge-relative sheet updates: what the fiction revealed,
    // unlocked, or exercised for this character this scene.
    capability_changes: z.array(CapabilityChangeSchema).optional(),
    // Debt economy: favors incurred or settled this scene.
    debt_changes: z.array(DebtChangeSchema).optional(),
    // Faction standing shifts earned this scene.
    standing_changes: z.array(StandingChangeSchema).optional(),
    // Corruption mark drawn from this campaign's corruption theme —
    // ignored entirely in campaigns without one (see lib/game/corruption.ts).
    corruption_change: z.object({
      marks: z.number(),
      reason: z.string()
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
    // New or updated long-term goal. Set this for a new NPC's starting goal,
    // or to give an existing major NPC a fresh direction after their
    // previous goal completed (see the "goalCompleted" world event).
    goals: z.string().optional(),
    // Minimal harm tracking (see NPC.harm in schema.prisma) — mirrors
    // pc_changes.harm_damage, applied via the same applyHarm(). This is
    // the only place a PC's weapon damageBonus has an honest target: an
    // NPC has no equivalent of a defender's armor, so there's no
    // reduction side to this, only the attacker's bonus.
    harm_damage: z.number().min(0).max(6).optional(),
    // Optional: names the PC whose action dealt this damage, so their
    // equipped weapon's damage bonus (lib/game/inventory.ts's
    // resolveDamageBonus) applies. Omitted just means no weapon bonus —
    // never a broken update.
    harm_damage_dealt_by: z.string().optional()
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

// id is never accepted from the AI — the engine derives it from name (see
// buildPerkFromAI in lib/game/advancement.ts), the same pattern MoveSchema
// already uses for the same dedup-across-rephrasings reason.
export const PerkSchema = z.object({
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional()
})

export const MoveSchema = z.object({
  name: z.string(),
  trigger: z.string(),
  description: z.string()
})

export const OrganicAdvancementSchema = z.object({
  character_id: z.string(),
  stat_increases: z.array(StatIncreaseSchema).optional(),
  new_perks: z.array(PerkSchema).optional(),
  new_moves: z.array(MoveSchema).optional()
})

// Location changes schema
export const LocationChangesSchema = z.object({
  name: z.string(),
  is_new: z.boolean().optional(),       // true when registering a new location
  description: z.string().optional(),   // what this place looks like / feels like
  location_type: z.string().optional(), // town, dungeon, wilderness, inn, building, etc.
  gm_notes_append: z.string().optional()
})

// Structured payout applied deterministically when a quest's status becomes
// COMPLETED this turn (see lib/game/stateUpdater.ts) — `reward` above stays
// free-form flavor text; this is what actually gets granted, the same way
// pc_changes' resource/inventory/standing changes are structured rather than
// left to a free-text description the code would have to guess at.
export const RewardGrantSchema = z.object({
  character_names: z.array(z.string()).optional(), // recipients; absent/empty = every living party member
  gold: z.number().optional(),
  items: z.array(InventoryItemSchema).optional(),
  standing_changes: z.array(StandingChangeSchema).optional()
})

// Quest lifecycle schema (see lib/game/stateUpdater.ts quest handling)
export const QuestChangeSchema = z.object({
  name: z.string(),
  is_new: z.boolean().optional(),
  changes: z.object({
    description: z.string().optional(),
    objective: z.string().optional(),
    given_by: z.string().optional(),
    reward: z.string().optional(),
    status: z.enum(['ACTIVE', 'COMPLETED', 'FAILED', 'ABANDONED']).optional(),
    progress_append: z.string().optional(),
    reward_grant: RewardGrantSchema.optional()
  })
})

// A corruption bargain narrated to a character this scene — persisted so
// the character's NEXT action can mechanically invoke it (corruption
// surge at roll time). Only meaningful in campaigns with a theme.
export const BargainOfferSchema = z.object({
  character_name_or_id: z.string(),
  offer: z.string()
})

// World updates schema
export const WorldUpdatesSchema = z.object({
  new_timeline_events: z.array(TimelineEventSchema).optional(),
  clock_changes: z.array(ClockChangeSchema).optional(),
  npc_changes: z.array(NPCChangesSchema).optional(),
  pc_changes: z.array(PCChangesSchema).optional(),
  faction_changes: z.array(FactionChangesSchema).optional(),
  location_changes: z.array(LocationChangesSchema).optional(),
  quest_changes: z.array(QuestChangeSchema).optional(),
  bargain_offers: z.array(BargainOfferSchema).optional(),
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
