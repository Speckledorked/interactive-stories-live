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
import { appendBounded, GM_NOTES_BOUNDS } from '../textAppend'

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
    // Case-INSENSITIVE, matching resolveOrCreateLocationId below.
    //
    // This used to be findUnique on the campaignId_name compound key,
    // which Postgres matches case-sensitively — so the two writers for
    // this one table disagreed about what counts as the same place. A
    // location_changes entry saying "the Docks" after "The Docks" already
    // existed minted a SECOND row, and every later lookup went through
    // the case-insensitive path and picked whichever findFirst returned.
    // Weather, isContested, faction territory and the corruption gates all
    // hang off Location, so a split row silently strands the party on one
    // copy while the state they care about lives on the other.
    const existing = await tx.location.findFirst({
      where: { campaignId, name: { equals: locChange.name, mode: 'insensitive' } }
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
        updateData.gmNotes = appendBounded(existing.gmNotes, locChange.gm_notes_append, GM_NOTES_BOUNDS)
      }
      // Corruption gates (#83). Written whenever reported, including back
      // to null — the fiction can consecrate a place as readily as taint
      // it, and a gate with no way to be lifted is the trap this design
      // exists to avoid.
      if (locChange.min_corruption !== undefined) updateData.minCorruption = locChange.min_corruption
      if (locChange.max_corruption !== undefined) updateData.maxCorruption = locChange.max_corruption
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
    } else if (locChange.is_new || locChange.description) {
      // Same guard NPCs and factions use: a bare name with nothing behind
      // it is a passing mention or a misspelling, not a request to mint a
      // row. is_new was declared and prompted for but never read until
      // now, so an unresolvable location name always created something.
      // The main path for real new places is unaffected — characters
      // moving somewhere go through resolveOrCreateLocationId below.
      await tx.location.create({
        data: {
          campaignId,
          name: locChange.name,
          description: locChange.description || null,
          locationType: locChange.location_type || null,
          gmNotes: locChange.gm_notes_append || null,
          // Corruption gates (#83) — these were dropped on the create path
          // while the update path above wrote them, so a location born
          // already gated came out ungated. Same read-at-one-end,
          // never-written-at-the-other defect as #88's rollModifier.
          minCorruption: locChange.min_corruption ?? null,
          maxCorruption: locChange.max_corruption ?? null,
          isDiscovered: sceneOrigin
        }
      })
      console.log(`  📍 Created location: ${locChange.name}`)
    } else {
      console.warn(`  ❓ location_changes: "${locChange.name}" is unknown and carries no description or is_new — skipped rather than minting a row from a passing mention`)
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
