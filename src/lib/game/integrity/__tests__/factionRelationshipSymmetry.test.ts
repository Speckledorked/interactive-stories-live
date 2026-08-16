// src/lib/game/integrity/__tests__/factionRelationshipSymmetry.test.ts
// #403 asked "if A calls B a rival, B calls A a rival". #373 answered it
// structurally — one canonically-ordered row per pair — so what is checked
// now is the ordering invariant that carries symmetry, plus the DB CHECK
// constraint that makes it hold.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { factionRelationshipsAreSymmetric } from '../checks/factionRelationshipSymmetry'
import { tieOrderingViolations } from '../../tick/types'
import { emptySnapshot } from './testHelpers'

const faction = (id: string, name: string) => ({ id, name, isActive: true, leaderCharacterId: null })

describe('tieOrderingViolations', () => {
  it('accepts canonically-ordered, distinct pairs', () => {
    expect(tieOrderingViolations([{ aId: 'a', bId: 'b' }, { aId: 'a', bId: 'c' }])).toEqual([])
  })

  it('flags a reversed pair', () => {
    expect(tieOrderingViolations([{ aId: 'b', bId: 'a' }]))
      .toEqual([{ aId: 'b', bId: 'a', problem: 'reversed' }])
  })

  it('flags a self-edge', () => {
    expect(tieOrderingViolations([{ aId: 'a', bId: 'a' }]))
      .toEqual([{ aId: 'a', bId: 'a', problem: 'self' }])
  })

  it('flags the same pair stored twice — the shape asymmetry takes now', () => {
    // Two rows for one pair is exactly the old failure: two stored copies
    // of one fact, free to disagree.
    expect(tieOrderingViolations([{ aId: 'a', bId: 'b' }, { aId: 'a', bId: 'b' }]))
      .toEqual([{ aId: 'a', bId: 'b', problem: 'duplicate' }])
  })
})

describe('factionRelationshipsAreSymmetric (#403, #373)', () => {
  it('reports nothing for a well-formed tie table', () => {
    const snapshot = emptySnapshot({
      factions: [faction('f1', 'The Crown'), faction('f2', 'The Guild')],
      factionTies: [{ aId: 'f1', bId: 'f2', type: 'RIVAL', since: 3 }],
    })
    expect(factionRelationshipsAreSymmetric.run(snapshot)).toEqual([])
  })

  it('names both factions when the ordering constraint is not holding', () => {
    const snapshot = emptySnapshot({
      factions: [faction('f1', 'The Crown'), faction('f2', 'The Guild')],
      factionTies: [{ aId: 'f2', bId: 'f1', type: 'RIVAL', since: 3 }],
    })
    const violations = factionRelationshipsAreSymmetric.run(snapshot)
    expect(violations).toHaveLength(1)
    expect(violations[0].description).toContain('The Guild')
    expect(violations[0].description).toContain('The Crown')
  })

  it('still reports when the faction rows themselves are gone', () => {
    // Falls back to ids rather than throwing — a snapshot missing the
    // factions is a worse problem, not a reason to swallow this one.
    const snapshot = emptySnapshot({ factionTies: [{ aId: 'f2', bId: 'f1', type: 'ALLY', since: 1 }] })
    expect(factionRelationshipsAreSymmetric.run(snapshot)).toHaveLength(1)
  })
})

describe('the constraints this check guards', () => {
  // The check above is only a REGRESSION guard if the constraint it
  // regresses from actually exists. Asserting the migration's text is the
  // cheapest honest way to say so without a live database — the same
  // reasoning behind the repo's other structural convention guards.
  const migrationsDir = join(process.cwd(), 'prisma', 'migrations')
  const allMigrationSql = readdirSync(migrationsDir)
    .filter((d) => !d.endsWith('.toml'))
    .map((d) => {
      try {
        return readFileSync(join(migrationsDir, d, 'migration.sql'), 'utf-8')
      } catch {
        return ''
      }
    })
    .join('\n')

  it('declares a canonical-ordering CHECK on both tie tables', () => {
    expect(allMigrationSql).toContain('"NpcTie_canonical_order" CHECK ("npcAId" < "npcBId")')
    expect(allMigrationSql).toContain('"FactionTie_canonical_order" CHECK ("factionAId" < "factionBId")')
  })

  it('declares a unique index on the ordered pair, so one pair is one row', () => {
    expect(allMigrationSql).toContain('CREATE UNIQUE INDEX "NpcTie_npcAId_npcBId_key"')
    expect(allMigrationSql).toContain('CREATE UNIQUE INDEX "FactionTie_factionAId_factionBId_key"')
  })

  it('declares cascading foreign keys on every endpoint', () => {
    // This is what turned npc.socialTies.keys.resolve and
    // faction.relationships.keys.resolve from live risks into regression
    // guards: a deleted entity takes its edges with it.
    for (const fk of [
      '"NpcTie_npcAId_fkey"',
      '"NpcTie_npcBId_fkey"',
      '"FactionTie_factionAId_fkey"',
      '"FactionTie_factionBId_fkey"',
    ]) {
      expect(allMigrationSql).toContain(fk)
    }
    expect(allMigrationSql).toContain('ALTER TABLE "NPC" DROP COLUMN "socialTies"')
    expect(allMigrationSql).toContain('ALTER TABLE "Faction" DROP COLUMN "relationships"')
  })
})
