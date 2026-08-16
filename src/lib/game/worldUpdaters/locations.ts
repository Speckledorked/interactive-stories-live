// src/lib/game/worldUpdaters/locations.ts
// Domain applier for world_updates.location_changes, plus
// resolveOrCreateLocationId — the shared helper every Character/NPC
// location write (AI-reported movement, the world tick's NPC commute,
// character/NPC creation and admin edits) uses to keep the new
// Character.locationId / NPC.locationId FK in sync with the free-text
// currentLocation string. Both operate on Location and match by name.
// See #4/#41 (stateUpdater decomposition) (stateUpdater decomposition, #4/#41; Location
// stored as free text, not an FK).
//
// #235 (adversarial audit): this was previously the one AI write-back
// entity type that never went through the shared exact -> confident-fuzzy
// -> ambiguous resolver (entityResolution.ts) every NPC/Faction/Character/
// consequence write-back uses. It matched with a raw case-insensitive
// `findFirst` and, on any miss, unconditionally created a new row — no
// ambiguity detection at all. That's a real, silent failure mode: an AI
// typo or hallucinated name minted a duplicate Location row instead of
// being caught the way a same-class NPC/Faction typo already is, and
// `entityResolutionConvention.test.ts`'s own AST guard couldn't catch it
// because it only scans for the literal property name `entity_id`, not
// the `name`/`location` fields this file resolves by. Both writers below
// now resolve identity via the same shared resolver, fetched once per
// call and re-used in-memory (fuzzy-match tolerant of AI-side typos/case/
// whitespace drift, and — the actual fix — failing CLOSED on an ambiguous
// multi-candidate match instead of picking one or minting a third row).

import { Prisma } from '@prisma/client'
import type { WorldUpdates } from '@/lib/ai/schema'
import { appendBounded, GM_NOTES_BOUNDS } from '../textAppend'
import { deriveResourceSlots } from '../resourceSlots'
import { sceneWorldChange } from './sceneWorldEvents'
import { resolveEntityByNameOrId } from '../entityResolution'
import type { WorldChange } from '../tick/types'

type Db = Prisma.TransactionClient
export type LocationChange = NonNullable<WorldUpdates['location_changes']>[number]

export async function applyLocationChanges(
  tx: Db,
  campaignId: string,
  locationChanges: LocationChange[],
  sceneOrigin: boolean
): Promise<{ worldChanges: WorldChange[] }> {
  console.log(`📍 Syncing ${locationChanges.length} location(s)`)
  const worldChanges: WorldChange[] = []

  // Fetched once per batch and resolved in-memory, same convention as
  // npcsForResolution/factionsForResolution in stateUpdater.ts — see the
  // #235 file header comment above. A newly-created row is pushed onto
  // this array so a second location_changes entry in the same batch
  // referencing the same new name resolves to it instead of minting a
  // second stub (mirrors npcs.ts's applyNpcChanges).
  const locationsForResolution = await tx.location.findMany({ where: { campaignId } })

  for (const locChange of locationChanges) {
    const resolution = resolveEntityByNameOrId(locationsForResolution, locChange.name)

    if (resolution.kind === 'ambiguous') {
      console.warn(`  ⚠️ location_changes: "${locChange.name}" matches multiple existing locations (${resolution.candidates.map(c => c.name).join(', ')}) — skipped rather than guessing or minting a duplicate`)
      continue
    }

    const existing = resolution.kind === 'found' ? resolution.entity : null

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
        // #175: locationType is the compact, narratively meaningful field
        // here — description/gmNotes are long free text, corruption
        // gates/discovery aren't independently interesting.
        if ('locationType' in updateData) {
          worldChanges.push(sceneWorldChange(
            campaignId, 'LOCATION', existing.id, existing.name, 'locationType',
            existing.locationType || '(unknown)', updateData.locationType, 'Scene resolution'
          ))
        }

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
      const created = await tx.location.create({
        data: {
          campaignId,
          name: locChange.name,
          description: locChange.description || null,
          locationType: locChange.location_type || null,
          // #378: a location born mid-story produces something too. The
          // whole logistics subsystem gates on this being non-empty, and
          // it had no writer anywhere — see game/resourceSlots.ts.
          resourceSlots: deriveResourceSlots({
            name: locChange.name,
            locationType: locChange.location_type ?? null,
            description: locChange.description ?? null,
          }),
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
      locationsForResolution.push(created)
      console.log(`  📍 Created location: ${locChange.name}`)
    } else {
      console.warn(`  ❓ location_changes: "${locChange.name}" is unknown and carries no description or is_new — skipped rather than minting a row from a passing mention`)
    }
  }

  return { worldChanges }
}

/**
 * Resolve a reported location name to its Location row's id — creating
 * the row if none exists yet, the same "a character standing there is
 * itself a discovery event" behavior the old auto-register pass had, now
 * also returning the id so a caller can set `locationId` in the same
 * write instead of only the free-text field.
 *
 * #235: resolves via the shared exact -> confident-fuzzy -> ambiguous
 * resolver (entityResolution.ts), the same one every NPC/Faction/
 * Character write-back already uses — not a raw case-insensitive
 * `findFirst`. Location's own campaignId+name uniqueness is exact-string
 * (unchanged, out of scope here), but nothing requires every *caller* of
 * this function to be exact-string too: resolving "the Docks" and "The
 * Docks" to the same row, or a trivial AI-side typo to the location it
 * obviously meant, is a strict improvement over minting a near-duplicate.
 * The one real behavior change: if the campaign already has more than one
 * location the reported name could plausibly mean (an ambiguous match,
 * the same failure mode #215 fixed for NPCs/factions), this now fails
 * CLOSED — returns null and leaves the caller's locationId unresolved —
 * instead of silently picking whichever row a bare `findFirst` returned
 * first, or minting a further duplicate.
 *
 * Returns null for a blank/missing name, an ambiguous match, or a
 * lookup/write error — never throws; linking the id is a best-effort
 * improvement, not a required part of persisting the character/NPC's own
 * update, so every failure mode here degrades to "no id linked" rather
 * than blocking the caller.
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
    const candidates = await tx.location.findMany({ where: { campaignId } })
    const resolution = resolveEntityByNameOrId(candidates, name)

    if (resolution.kind === 'ambiguous') {
      console.warn(`  ⚠️ resolveOrCreateLocationId: "${name}" matches multiple existing locations (${resolution.candidates.map(c => c.name).join(', ')}) — leaving locationId unresolved rather than guessing or minting a duplicate`)
      return null
    }

    if (resolution.kind === 'found') {
      const existing = resolution.entity
      // A character/NPC standing there is itself a discovery event, same
      // reveal-on-mention rule as location_changes — never on an
      // offscreen background update.
      if (sceneOrigin && !existing.isDiscovered) {
        await tx.location.update({ where: { id: existing.id }, data: { isDiscovered: true } })
      }
      return existing.id
    }

    const created = await tx.location.create({
      data: {
        campaignId,
        name,
        isDiscovered: sceneOrigin,
        // #378: same reasoning as the richer create path above — this is
        // the MAIN way real new places appear (a character moving
        // somewhere), so it is the one that most needs to produce a
        // location the logistics tick can actually see.
        resourceSlots: deriveResourceSlots({ name }),
      },
    })
    return created.id
  } catch {
    return null
  }
}
