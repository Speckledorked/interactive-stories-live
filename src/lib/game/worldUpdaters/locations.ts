// src/lib/game/worldUpdaters/locations.ts
// Domain appliers for world_updates.location_changes, plus the
// auto-register-from-character-movement pass (former "7b"). Both operate
// on Location and match by exact (unique) name, not fuzzy resolution — a
// location's campaignId+name is already a real unique constraint, so this
// domain never had the `contains`-matching bug the others did.
// See README Known Bugs P1 (stateUpdater decomposition, #4/#41).

import { Prisma } from '@prisma/client'
import type { WorldUpdates } from '@/lib/ai/schema'

type Db = Prisma.TransactionClient
export type LocationChange = NonNullable<WorldUpdates['location_changes']>[number]
export type PcChangeForMovement = NonNullable<WorldUpdates['pc_changes']>[number]

export async function applyLocationChanges(
  tx: Db,
  campaignId: string,
  locationChanges: LocationChange[],
  sceneOrigin: boolean
): Promise<void> {
  console.log(`📍 Syncing ${locationChanges.length} location(s)`)

  for (const locChange of locationChanges) {
    const existing = await tx.location.findUnique({
      where: { campaignId_name: { campaignId, name: locChange.name } }
    })

    if (existing) {
      const updateData: any = {}
      if (locChange.description && !existing.description) {
        updateData.description = locChange.description
      }
      if (locChange.location_type && !existing.locationType) {
        updateData.locationType = locChange.location_type
      }
      if (locChange.gm_notes_append) {
        updateData.gmNotes = (existing.gmNotes || '') + '\n\n' + locChange.gm_notes_append
      }
      // Fog of war: same reveal-on-mention rule as NPC/Faction — a live
      // scene touching this location means the party is there, so it's
      // discovered; an offscreen tick mentioning it must not out it.
      if (sceneOrigin && !existing.isDiscovered) {
        updateData.isDiscovered = true
      }
      if (Object.keys(updateData).length > 0) {
        await tx.location.update({
          where: { id: existing.id },
          data: updateData
        })
        console.log(`  📍 Updated location: ${locChange.name}`)
      }
    } else {
      await tx.location.create({
        data: {
          campaignId,
          name: locChange.name,
          description: locChange.description || null,
          locationType: locChange.location_type || null,
          gmNotes: locChange.gm_notes_append || null,
          isDiscovered: sceneOrigin
        }
      })
      console.log(`  📍 Created location: ${locChange.name}`)
    }
  }
}

/**
 * A PC's reported location that doesn't exist yet as a Location row gets
 * one — a PC standing there is itself a discovery event. Non-critical: a
 * concurrent-write failure is swallowed, same as the original inline code.
 */
export async function autoRegisterLocationsFromMovement(
  tx: Db,
  campaignId: string,
  pcChanges: PcChangeForMovement[],
  sceneOrigin: boolean
): Promise<void> {
  for (const pcChange of pcChanges) {
    if (!pcChange.changes.location) continue
    const locationName = pcChange.changes.location
    try {
      await tx.location.upsert({
        where: { campaignId_name: { campaignId, name: locationName } },
        create: {
          campaignId,
          name: locationName,
          isDiscovered: sceneOrigin
        },
        // A PC standing there is itself a discovery event, so reveal on
        // update too — same reveal-on-mention rule as location_changes.
        update: sceneOrigin ? { isDiscovered: true } : {}
      })
    } catch {
      // Ignore if upsert fails (e.g., concurrent write) — non-critical
    }
  }
}
