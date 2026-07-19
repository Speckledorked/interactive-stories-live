// src/lib/game/worldUpdaters/locations.ts
// Domain applier for world_updates.location_changes, plus
// resolveOrCreateLocationId — the shared helper every Character/NPC
// location write (AI-reported movement, the world tick's NPC commute,
// character/NPC creation and admin edits) uses to keep the new
// Character.locationId / NPC.locationId FK in sync with the free-text
// currentLocation string. Both operate on Location and match by name — a
// location's campaignId+name is already a real unique constraint, so this
// domain never had the `contains`-matching bug the others did.
// See README Known Bugs P1 (stateUpdater decomposition, #4/#41; Location
// stored as free text, not an FK).

import { Prisma } from '@prisma/client'
import type { WorldUpdates } from '@/lib/ai/schema'

type Db = Prisma.TransactionClient
export type LocationChange = NonNullable<WorldUpdates['location_changes']>[number]

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
 * Resolve a reported location name to its Location row's id — creating
 * the row if none exists yet, the same "a character standing there is
 * itself a discovery event" behavior the old auto-register pass had, now
 * also returning the id so a caller can set `locationId` in the same
 * write instead of only the free-text field.
 *
 * Matches case/whitespace-insensitively before falling back to create:
 * Location's own campaignId+name uniqueness is exact-string (unchanged,
 * out of scope here), but nothing requires every *caller* of this
 * function to be exact-string too — resolving "the Docks" and "The
 * Docks" to the same row here, before either would otherwise create a
 * near-duplicate, is a strict improvement with no behavior change for
 * any caller that already had an exact match.
 *
 * Returns null only for a blank/missing name — never throws; a
 * concurrent-write race is swallowed the same as the original inline
 * upsert was, since linking the id is a best-effort improvement, not a
 * required part of persisting the character/NPC's own update.
 */
export async function resolveOrCreateLocationId(
  tx: Db,
  campaignId: string,
  locationName: string | null | undefined,
  sceneOrigin: boolean
): Promise<string | null> {
  const name = locationName?.trim()
  if (!name) return null

  try {
    const existing = await tx.location.findFirst({
      where: { campaignId, name: { equals: name, mode: 'insensitive' } },
    })

    if (existing) {
      // A character/NPC standing there is itself a discovery event, same
      // reveal-on-mention rule as location_changes — never on an
      // offscreen background update.
      if (sceneOrigin && !existing.isDiscovered) {
        await tx.location.update({ where: { id: existing.id }, data: { isDiscovered: true } })
      }
      return existing.id
    }

    const created = await tx.location.create({
      data: { campaignId, name, isDiscovered: sceneOrigin },
    })
    return created.id
  } catch {
    return null
  }
}
