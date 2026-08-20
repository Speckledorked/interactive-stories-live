// src/components/character/__tests__/progressionSurfaces.test.ts
//
// Both surfaces that show progression must derive it the same way, and the
// route must actually ship what they derive it from.
//
// Two failure shapes this repo has already paid for, one after the other:
//
//   1. A second copy of a derivation. Harm colour cutoffs ended up hand-rolled
//      in four places; resourceSlots had a SQL backfill and a TS function that
//      disagreed from the day they shipped. A rank ladder is worse to
//      duplicate, because a wrong tier index renders as a confident, wrong
//      progress bar rather than as an error.
//
//   2. A reader wired to a field nobody sends. advancementTrack sat null on
//      every campaign because creation never wrote it, and the snapshot modal
//      showed no rank because its route never returned the track. Both times
//      the rendering code was correct and complete, and both times nothing
//      failed — null and undefined are legitimate here, so "not delivered"
//      looks exactly like "this universe has no ladder".
//
// So: same helpers on both surfaces, and the payload must carry the ladder.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = process.cwd()
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf-8')

const SURFACES = [
  { name: 'CharacterSheetDisplay', src: read('src', 'components', 'character', 'CharacterSheetDisplay.tsx') },
  { name: 'CharacterSnapshotModal', src: read('src', 'components', 'character', 'CharacterSnapshotModal.tsx') },
]

const ROUTE = read('src', 'app', 'api', 'campaigns', '[id]', 'characters', '[characterId]', 'route.ts')

describe('progression renders from one derivation', () => {
  it.each(SURFACES)('$name uses the shared helpers', ({ src }) => {
    expect(src).toMatch(/from '@\/lib\/game\/advancementTrack'/)
    for (const helper of ['parseAdvancementTrack', 'tierProgress', 'slotProgress']) {
      expect(src).toContain(helper)
    }
  })

  it.each(SURFACES)('$name does not hand-roll a second tier lookup', ({ src }) => {
    // The specific shape a re-derivation takes: finding the character's rung
    // by scanning tiers directly instead of asking tierProgress, which is
    // where an off-by-one becomes a wrong rank rendered confidently.
    expect(src).not.toMatch(/\.tiers\s*\.\s*(findIndex|find)\s*\(/)
    // Likewise counting slot fill by hand rather than from capabilities.
    expect(src).not.toMatch(/slotGroups\s*\.\s*map\s*\([^)]*capacity[^)]*filled/)
  })

  it.each(SURFACES)('$name hides the whole section when there is no track', ({ src }) => {
    // Null is a real answer. Neither surface may render an empty heading,
    // which would read as "your rank is missing" rather than "this world has
    // no ranks".
    expect(src).toContain('{(tier || slots.length > 0) && (')
  })
})

describe('the character route ships what those surfaces need', () => {
  it('returns the campaign advancement track', () => {
    // advancementTrack is the CAMPAIGN's; advancementTier is the character's.
    // Without the former, the latter cannot be placed on anything, and the
    // surface renders nothing while looking entirely healthy.
    expect(ROUTE).toMatch(/advancementTrack:\s*true/)
    expect(ROUTE).toMatch(/campaign:\s*\{\s*advancementTrack/)
  })

  it('reads it from the campaign, not the character', () => {
    // A track selected off the character row would be undefined forever —
    // the column does not exist there — and undefined is indistinguishable
    // from "no ladder" at every reader.
    const select = ROUTE.slice(ROUTE.indexOf('prisma.campaign.findUnique'), ROUTE.indexOf('// Get character'))
    expect(select).toContain('advancementTrack')
    expect(select).toContain('where: { id: campaignId }')
  })
})
