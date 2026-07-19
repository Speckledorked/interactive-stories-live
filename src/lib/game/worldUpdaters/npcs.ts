// src/lib/game/worldUpdaters/npcs.ts
// Domain applier for world_updates.npc_changes. See README Known Bugs P1
// (stateUpdater decomposition, #4/#41).

import { Prisma, NPC, Character } from '@prisma/client'
import type { WorldUpdates } from '@/lib/ai/schema'
import { resolveEntityByNameOrId } from '../entityResolution'
import { applyHarm, HarmLevel } from '../harm'
import { resolveDamageBonus } from '../inventory'

type Db = Prisma.TransactionClient
export type NpcChange = NonNullable<WorldUpdates['npc_changes']>[number]

export interface NpcChangesResult {
  involvedNpcIds: string[]
}

/**
 * `npcsForResolution` is mutated (a newly-created stub NPC is pushed onto
 * it) so a later npc_change in the same batch referencing the same new
 * name resolves to it instead of spawning a second stub.
 */
export async function applyNpcChanges(
  tx: Db,
  campaignId: string,
  npcChanges: NpcChange[],
  npcsForResolution: NPC[],
  charactersForResolution: Character[],
  sceneOrigin: boolean
): Promise<NpcChangesResult> {
  console.log(`👤 Updating ${npcChanges.length} NPCs`)

  const involvedNpcIds = new Set<string>()

  for (const npcChange of npcChanges) {
    const npcResolution = resolveEntityByNameOrId(npcsForResolution, npcChange.npc_name_or_id)
    const npc = npcResolution.kind === 'found' ? npcResolution.entity : null
    if (npcResolution.kind === 'ambiguous') {
      console.warn(`  ⚠️ Ambiguous NPC name "${npcChange.npc_name_or_id}" — matches ${npcResolution.candidates.map(c => c.name).join(', ')}, skipping rather than guessing or creating a duplicate`)
    }

    if (npc) {
      involvedNpcIds.add(npc.id)
      const updateData: any = {}

      // Append to GM notes if provided
      if (npcChange.changes.notes_append) {
        updateData.gmNotes = (npc.gmNotes || '') + '\n\n' + npcChange.changes.notes_append
      }

      // Update description if AI provided one and NPC has none yet
      if (npcChange.changes.description && !npc.description) {
        updateData.description = npcChange.changes.description
      }

      // New/updated goal — a fresh goal starts its progress over,
      // regardless of what was left on the previous one.
      if (npcChange.changes.goals) {
        updateData.goals = npcChange.changes.goals
        updateData.goalProgress = 0
      }

      // Minimal harm tracking (see NPC.harm's doc comment in
      // schema.prisma) — mirrors pc_changes.harm_damage via the same
      // applyHarm(), but with no armor-reduction side (NPCs don't carry
      // equipment) and no conditions/death-saves: just a harm number and
      // a one-way Taken Out flip.
      if (npcChange.changes.harm_damage && npcChange.changes.harm_damage > 0) {
        let weaponBonus = 0
        if (npcChange.changes.harm_damage_dealt_by) {
          const attackerResolution = resolveEntityByNameOrId(charactersForResolution, npcChange.changes.harm_damage_dealt_by)
          const attacker = attackerResolution.kind === 'found' ? attackerResolution.entity : null
          if (attacker) {
            const weaponName = (attacker.equipment as any)?.weapon || ''
            weaponBonus = resolveDamageBonus(attacker.inventory as any, weaponName)
          }
        }
        const harmResult = applyHarm(
          ((npc.harm as number) || 0) as HarmLevel,
          npcChange.changes.harm_damage + weaponBonus,
          0
        )
        updateData.harm = harmResult.newHarm
        if (harmResult.newHarm >= 6) {
          updateData.isAlive = false
        }
        console.log(`  💥 ${npc.name}: ${harmResult.message}`)
      }

      // Fog of war: the party witnessing this NPC in a live scene is
      // what reveals them — never on an offscreen background update.
      if (sceneOrigin && !npc.isDiscovered) {
        updateData.isDiscovered = true
      }

      if (Object.keys(updateData).length > 0) {
        await tx.nPC.update({
          where: { id: npc.id },
          data: updateData
        })

        console.log(`  👤 Updated NPC: ${npc.name}`)
      }
    } else if (npcResolution.kind === 'not_found' && (npcChange.is_new || npcChange.changes.description)) {
      // Auto-create a stub NPC when the AI introduces a new character mid-scene
      const newNPC = await tx.nPC.create({
        data: {
          campaignId,
          name: npcChange.npc_name_or_id,
          description: npcChange.changes.description || null,
          gmNotes: npcChange.changes.notes_append || null,
          goals: npcChange.changes.goals || null,
          importance: 1,
          isAlive: true,
          // Fog of war: an NPC introduced offscreen (e.g. a tournament
          // winner) exists but isn't "met" yet — undiscovered until a
          // live scene actually involves them.
          isDiscovered: sceneOrigin
        }
      })
      npcsForResolution.push(newNPC)
      involvedNpcIds.add(newNPC.id)
      console.log(`  👤 Created new NPC: ${newNPC.name}`)
    } else if (npcResolution.kind === 'not_found') {
      console.warn(`  ⚠️ NPC not found and no stub info provided: ${npcChange.npc_name_or_id}`)
    }
  }

  return { involvedNpcIds: [...involvedNpcIds] }
}
