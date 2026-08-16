// src/lib/notifications/__tests__/worldDigest.test.ts
// World-visibility digest: fog-filtered selection and diegetic templates.

import { describe, it, expect } from 'vitest'
import { selectDigestChanges, formatDigestLine } from '../world-digest'
import type { WorldChange } from '@/lib/game/tick/types'

const change = (overrides: Partial<WorldChange>): WorldChange => ({
  entityType: 'FACTION',
  entityId: 'f1',
  entityName: 'Thieves Guild',
  campaignId: 'camp1',
  field: 'warDeclared',
  previousValue: 'rivals',
  newValue: 'at war',
  reason: 'GM-grade reason that may name undiscovered factions',
  significant: true,
  importance: 'MAJOR',
  ...overrides,
})

describe('selectDigestChanges', () => {
  it('keeps only MAJOR significant changes for discovered entities', () => {
    const changes = [
      change({}), // discovered, MAJOR → in
      change({ entityId: 'hidden', entityName: 'Secret Cabal' }), // undiscovered → out
      change({ importance: 'NORMAL' }), // routine → out
      change({ significant: false }), // noise → out
    ]
    const selected = selectDigestChanges(changes, new Set(['f1']))
    expect(selected).toHaveLength(1)
    expect(selected[0].entityId).toBe('f1')
  })

  it('no longer caps the raw selection itself — see groupDigestChangesByField in world-digest.test.ts, which caps after grouping', () => {
    const changes = Array.from({ length: 6 }, (_, i) =>
      change({ entityId: `f${i}` })
    )
    const selected = selectDigestChanges(changes, new Set(changes.map(c => c.entityId)))
    expect(selected).toHaveLength(6)
  })
})

describe('formatDigestLine', () => {
  it('templates known fields diegetically without using reason', () => {
    expect(formatDigestLine(change({ field: 'warDeclared' }))).toContain('declared war')
    expect(formatDigestLine(change({ field: 'collapsed' }))).toContain('has fallen')
    expect(formatDigestLine(change({ field: 'warResolved' }))).toContain('is over')
    // The GM-grade reason string must never leak into a player digest.
    for (const field of ['warDeclared', 'collapsed', 'warJoined', 'somethingUnknown']) {
      expect(formatDigestLine(change({ field }))).not.toContain('undiscovered')
    }
  })

  it('renders nothing for a field with no authored phrasing (#432)', () => {
    // Was: "falls back to a generic upheaval line". The fallback is gone —
    // it was what made every unmapped MAJOR field, including an important
    // NPC's routine movement, read as the same sentence every turn.
    expect(formatDigestLine(change({ field: 'mystery' }))).toBe('')
  })
})
