// src/lib/game/worldUpdaters/npcs.ts
// Domain applier for world_updates.npc_changes. See README Known Bugs P1
// (stateUpdater decomposition, #4/#41).

import { Prisma, NPC, Character } from '@prisma/client'
import type { WorldUpdates } from '@/lib/ai/schema'
import { resolveEntityByNameOrId } from '../entityResolution'
import { applyHarm, healHarm, HarmLevel } from '../harm'
import { resolveDamageBonus } from '../inventory'
import { appendBounded, GM_NOTES_BOUNDS } from '../textAppend'
import { isUniqueConstraintViolation } from './uniqueConstraintGuard'
import { sceneWorldChange } from './sceneWorldEvents'
import type { WorldChange } from '../tick/types'

type Db = Prisma.TransactionClient
export type NpcChange = NonNullable<WorldUpdates['npc_changes']>[number]

export interface NpcChangesResult {
  involvedNpcIds: string[]
  worldChanges: WorldChange[]
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
  const worldChanges: WorldChange[] = []

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
        updateData.gmNotes = appendBounded(npc.gmNotes, npcChange.changes.notes_append, GM_NOTES_BOUNDS)
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

      // Recovery. Mirrors pc_changes.harm_healing via the same healHarm(),
      // and is the counterpart the damage path above never had: without it
      // an NPC's harm could only ever climb. Applied on top of any damage
      // dealt in the same batch, so a scene that both wounds and patches up
      // the same NPC nets out correctly rather than dropping one of them.
      if (npcChange.changes.harm_healing && npcChange.changes.harm_healing > 0) {
        const startingHarm = (updateData.harm ?? (npc.harm as number) ?? 0) as HarmLevel
        const healResult = healHarm(startingHarm, npcChange.changes.harm_healing)
        updateData.harm = healResult.newHarm
        // An NPC below the Taken Out threshold is on their feet again.
        // isAlive is only ever flipped back true here, never by the damage
        // path — recovering from a wound is not resurrection, and an NPC
        // already marked dead stays dead.
        if (healResult.newHarm < 6 && npc.isAlive) {
          updateData.isAlive = true
        }
        console.log(`  💚 ${npc.name}: ${healResult.message}`)
      }

      // Fog of war: the party witnessing this NPC in a live scene is
      // what reveals them — never on an offscreen background update.
      if (sceneOrigin && !npc.isDiscovered) {
        updateData.isDiscovered = true
      }

      // Corruption gates (#83). An NPC who requires (or is repulsed by)
      // what a character has become gives their rapport no roll weight —
      // see the leverage gate in resolution.ts. Written whenever reported,
      // including back to null: a gate the fiction can't lift is the trap
      // this design exists to avoid.
      if (npcChange.changes.min_corruption !== undefined) updateData.minCorruption = npcChange.changes.min_corruption
      if (npcChange.changes.max_corruption !== undefined) updateData.maxCorruption = npcChange.changes.max_corruption

      if (Object.keys(updateData).length > 0) {
        // #175: derived from the same updateData diff about to be
        // persisted. gmNotes/corruption-gate fields deliberately skipped
        // (verbose free text / not narratively interesting on their own).
        if ('goals' in updateData) {
          worldChanges.push(sceneWorldChange(
            campaignId, 'NPC', npc.id, npc.name, 'goals',
            npc.goals || '(none)', updateData.goals, 'Scene resolution'
          ))
        }
        if ('harm' in updateData && (npc.harm ?? 0) !== updateData.harm) {
          worldChanges.push(sceneWorldChange(
            campaignId, 'NPC', npc.id, npc.name, 'harm',
            npc.harm ?? 0, updateData.harm, 'Scene resolution'
          ))
        }
        if ('isAlive' in updateData) {
          worldChanges.push(sceneWorldChange(
            campaignId, 'NPC', npc.id, npc.name, 'isAlive',
            npc.isAlive ? 'alive' : 'deceased', updateData.isAlive ? 'alive' : 'deceased', 'Scene resolution',
            updateData.isAlive === false ? 'MAJOR' : 'NORMAL'
          ))
        }

        await tx.nPC.update({
          where: { id: npc.id },
          data: updateData
        })

        console.log(`  👤 Updated NPC: ${npc.name}`)
      }
    } else if (npcResolution.kind === 'not_found' && (npcChange.is_new || npcChange.changes.description)) {
      // Auto-create a stub NPC when the AI introduces a new character mid-scene.
      // resolveEntityByNameOrId just confirmed no existing NPC matches this
      // name, so the unique constraint below should never actually fire —
      // but that exact "should never happen" reasoning was wrong twice this
      // session (the Phase 0 bugs), and this create runs inside the same
      // transaction as every other domain's changes for this scene. Losing
      // one stub NPC is recoverable next turn; rolling back the whole
      // scene's world_updates because of it would not be.
      try {
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
            isDiscovered: sceneOrigin,
            minCorruption: npcChange.changes.min_corruption ?? null,
            maxCorruption: npcChange.changes.max_corruption ?? null
          }
        })
        npcsForResolution.push(newNPC)
        involvedNpcIds.add(newNPC.id)
        console.log(`  👤 Created new NPC: ${newNPC.name}`)
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error
        console.warn(`  ⚠️ NPC "${npcChange.npc_name_or_id}" collided with an existing name at write time — skipping this stub rather than aborting the scene`)
      }
    } else if (npcResolution.kind === 'not_found') {
      console.warn(`  ⚠️ NPC not found and no stub info provided: ${npcChange.npc_name_or_id}`)
    }
  }

  return { involvedNpcIds: [...involvedNpcIds], worldChanges }
}
