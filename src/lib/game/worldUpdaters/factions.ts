// src/lib/game/worldUpdaters/factions.ts
// Domain applier for world_updates.faction_changes. See README Known Bugs
// P1 (stateUpdater decomposition, #4/#41).

import { Prisma, Faction } from '@prisma/client'
import type { WorldUpdates } from '@/lib/ai/schema'
import { resolveEntityByNameOrId } from '../entityResolution'

type Db = Prisma.TransactionClient
export type FactionChange = NonNullable<WorldUpdates['faction_changes']>[number]

export interface FactionChangesResult {
  involvedFactionIds: string[]
}

const THREAT_LEVEL_MAP: Record<string, number> = {
  LOW: 1, MEDIUM: 2, HIGH: 3, EXTREME: 4
}

/**
 * `factionsForResolution` is mutated (a newly-created stub faction is
 * pushed onto it) so a later faction_change in the same batch referencing
 * the same new name resolves to it instead of spawning a duplicate.
 */
export async function applyFactionChanges(
  tx: Db,
  campaignId: string,
  factionChanges: FactionChange[],
  factionsForResolution: Faction[],
  sceneOrigin: boolean
): Promise<FactionChangesResult> {
  console.log(`🏛️ Updating ${factionChanges.length} factions`)

  const involvedFactionIds = new Set<string>()

  for (const factionChange of factionChanges) {
    const factionResolution = resolveEntityByNameOrId(factionsForResolution, factionChange.faction_name_or_id)
    const faction = factionResolution.kind === 'found' ? factionResolution.entity : null
    if (factionResolution.kind === 'ambiguous') {
      console.warn(`  ⚠️ Ambiguous faction name "${factionChange.faction_name_or_id}" — matches ${factionResolution.candidates.map(c => c.name).join(', ')}, skipping rather than guessing or creating a duplicate`)
    }

    if (faction) {
      involvedFactionIds.add(faction.id)
      const updateData: any = {}

      if (factionChange.changes.current_plan) {
        updateData.currentPlan = factionChange.changes.current_plan
      }

      if (factionChange.changes.threat_level) {
        const level = factionChange.changes.threat_level.toUpperCase()
        updateData.threatLevel = THREAT_LEVEL_MAP[level] || faction.threatLevel
      }

      // World Sim Phase 6: only a player-led faction's goal is settable
      // this way — for any other faction the deterministic tick
      // (factionTick.ts) owns goal reassessment, and honoring an AI-set
      // goal here would just get silently overwritten (or worse, fought
      // over) on the next tick. Enforced server-side, not just by prompt
      // instruction, since AI output isn't trustworthy enough to be the
      // only guard.
      if (factionChange.changes.goal && faction.leaderCharacterId) {
        updateData.goal = factionChange.changes.goal
      }

      if (factionChange.changes.gm_notes_append) {
        updateData.gmNotes = faction.gmNotes + '\n\n' + factionChange.changes.gm_notes_append
      }

      // Fog of war: the party witnessing this faction in a live scene
      // is what reveals it — never on an offscreen background update.
      if (sceneOrigin && !faction.isDiscovered) {
        updateData.isDiscovered = true
      }

      if (Object.keys(updateData).length > 0) {
        await tx.faction.update({
          where: { id: faction.id },
          data: updateData
        })

        console.log(`  🏛️ Updated faction: ${faction.name}`)
      }
    } else if (factionResolution.kind === 'not_found' && (factionChange.is_new || factionChange.changes.description)) {
      // Auto-create a stub faction when the AI introduces a new group mid-campaign
      const initialThreat = factionChange.changes.threat_level
        ? (THREAT_LEVEL_MAP[factionChange.changes.threat_level.toUpperCase()] || 1)
        : 1
      const newFaction = await tx.faction.create({
        data: {
          campaignId,
          name: factionChange.faction_name_or_id,
          description: factionChange.changes.description || '',
          goals: factionChange.changes.goals || '',
          currentPlan: factionChange.changes.current_plan || '',
          threatLevel: initialThreat,
          gmNotes: factionChange.changes.gm_notes_append || '',
          // Fog of war: a faction introduced offscreen exists but isn't
          // "known" yet — undiscovered until a live scene actually
          // involves it.
          isDiscovered: sceneOrigin
        }
      })
      factionsForResolution.push(newFaction)
      involvedFactionIds.add(newFaction.id)
      console.log(`  🏛️ Created new faction: ${newFaction.name}`)
    } else if (factionResolution.kind === 'not_found') {
      console.warn(`  ⚠️ Faction not found and no stub info provided: ${factionChange.faction_name_or_id}`)
    }
  }

  return { involvedFactionIds: [...involvedFactionIds] }
}
