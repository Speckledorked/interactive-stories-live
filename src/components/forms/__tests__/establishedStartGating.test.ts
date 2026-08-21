// src/components/forms/__tests__/establishedStartGating.test.ts
//
// The "Already mastered" picker must not require a rank ladder.
//
// First shipped gated on `track && track.tiers.length > 0` — the whole
// established-start section, capability picker included, vanished in any
// universe without a spoken ladder. Which is most of them: Harry Potter has
// school years at best; a superhero setting has nothing anyone would say
// out loud. An established Auror or a hero with powers already in hand is a
// legitimate concept in exactly those worlds, and the server accepted the
// loadout all along (capacity checks skip without a track) — only the form
// hid the door.
//
// Structural, like characterSheetTabs.test.ts: the gating expressions are
// the defect surface, and no unit test rendering the form with one fixture
// campaign would notice the other kind of campaign losing the section.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(
  join(process.cwd(), 'src', 'components', 'forms', 'EnhancedCreateCharacterForm.tsx'),
  'utf-8'
)

describe('established-start gating', () => {
  it('fetches the capability list regardless of the ladder', () => {
    // The fetch effect must not early-return on a missing track. A
    // ladderless campaign still has capabilities to start with.
    const at = src.indexOf('authenticatedFetch(`/api/campaigns/${campaignId}/capabilities`)')
    expect(at).toBeGreaterThan(-1)
    const effect = src.slice(Math.max(0, at - 600), at)
    expect(effect).not.toMatch(/if\s*\(\s*!track\s*\)\s*return/)
  })

  it('shows the section when EITHER a ladder or pickable capabilities exist', () => {
    expect(src).toContain('{((track && track.tiers.length > 0) || pickableCapabilities.length > 0) && (')
  })

  it('gates only the rank select on tiers, inside the section', () => {
    const section = src.slice(src.indexOf('Where do they start?'))
    const rankGate = section.indexOf('{track && track.tiers.length > 0 && (')
    const picker = section.indexOf('pickableCapabilities.length > 0 && (')
    expect(rankGate).toBeGreaterThan(-1)
    // The picker must render independently of the rank gate — not appear
    // before the section, and not be the same conditional.
    expect(picker).toBeGreaterThan(rankGate)
  })

  it('slot counters tolerate a missing track', () => {
    // A ladderless universe has no slot groups; the counters must be
    // optional-chained rather than assuming track exists because the
    // section rendered.
    expect(src).toContain('(track?.slotGroups ?? []).map(group')
    expect(src).toContain('track?.slotGroups.find(g => g.domain === cap.domain)')
  })
})
