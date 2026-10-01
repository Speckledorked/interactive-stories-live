// src/lib/worlds/__tests__/worldSnapshot.test.ts
//
// #490 — the format a published world is stored in.
//
// Three things worth pinning. What a snapshot MUST NOT contain, because a
// published world leaking somebody's play history is the failure that
// cannot be taken back. The version refusal, because guessing at an unknown
// snapshot seeds a campaign from misread fields and hands the forker a
// broken world to work out for themselves. And the slug rules, because a
// slug is permanent once it is in a link.

import { describe, it, expect } from 'vitest'
import {
  buildWorldSnapshot,
  snapshotToPreGenerated,
  isPublishable,
  slugifyTitle,
  type SnapshotSource,
  type SnapshotRelations,
} from '../worldSnapshot'

const source: SnapshotSource = {
  initialWorldSeed: 'The pass has been closed since autumn.',
  statLabels: { cool: { label: 'Poise', description: 'd' } } as never,
  corruptionTheme: { name: 'The Rot' } as never,
  advancementTrack: { ranks: ['Hand', 'Voice'] } as never,
  calendarConfig: { months: [] } as never,
  worldRules: { rules: [{ family: 'no-flight' }] } as never,
}

const relations: SnapshotRelations = {
  factions: [
    { name: 'Ashcrown', description: 'd', goals: 'g', resources: 50, influence: 40, threatLevel: 2 },
  ],
  capabilities: [
    { domain: 'Ember Work', name: 'Kindling', description: 'd', tier: 1, isSecret: false },
  ] as never,
  fronts: [{ name: 'The Long Winter' }] as never,
  archetypes: [{ name: 'Snowbound' }],
  moveFlavor: [{ name: 'Press On' }],
  npcs: [{ name: 'Oathe' }],
  locations: [{ name: 'Gallow Pass' }],
}

describe('what a snapshot carries', () => {
  it('carries the world definition', () => {
    const snapshot = buildWorldSnapshot(source, relations)

    expect(snapshot.version).toBe(1)
    expect(snapshot.worldSeed).toBe('The pass has been closed since autumn.')
    expect(snapshot.factions).toHaveLength(1)
    expect(snapshot.capabilities).toHaveLength(1)
    expect(snapshot.statLabels).toEqual({ cool: { label: 'Poise', description: 'd' } })
    expect(snapshot.corruptionTheme).toEqual({ name: 'The Rot' })
    expect(snapshot.advancementTrack).toEqual({ ranks: ['Hand', 'Voice'] })
    expect(snapshot.calendar).toEqual({ months: [] })
    expect(snapshot.archetypes).toHaveLength(1)
  })

  it('unwraps worldRules to the bare list the generator produces', () => {
    // Stored on the campaign as { rules: [...] }, generated as a list. The
    // snapshot always holds the list, so a reader never has to know which.
    expect(buildWorldSnapshot(source, relations).worldRules).toEqual([{ family: 'no-flight' }])
  })

  it('survives a campaign whose generated columns are all null', () => {
    // Pre-existing campaigns, and any whose generation failed. Publishing
    // one must produce a world, not a crash.
    const snapshot = buildWorldSnapshot(
      {
        initialWorldSeed: '',
        statLabels: null,
        corruptionTheme: null,
        advancementTrack: null,
        calendarConfig: null,
        worldRules: null,
      },
      relations
    )

    expect(snapshot.statLabels).toBeNull()
    expect(snapshot.calendar).toBeNull()
    expect(snapshot.worldRules).toEqual([])
    expect(snapshot.worldSeed).toBe('')
  })

  it('carries no play history whatsoever', () => {
    // The failure that cannot be taken back. A snapshot is a SETTING; the
    // chronicle share link already exists for reading someone's game, and
    // forking into a stranger's transcript is both the wrong feature and a
    // privacy problem. Asserted against the serialised form, since that is
    // what actually goes in the row.
    const serialised = JSON.stringify(buildWorldSnapshot(source, relations))

    for (const forbidden of [
      'scene', 'Scene',
      'character', 'Character',
      'message', 'Message',
      'whisper', 'Whisper',
      'diceRoll', 'playerAction',
      'gmNotes',
    ]) {
      expect(serialised).not.toContain(forbidden)
    }
  })
})

describe('what is publishable', () => {
  it('accepts a world with factions', () => {
    expect(isPublishable(buildWorldSnapshot(source, relations))).toBe(true)
  })

  it('accepts a world with only a capability tree', () => {
    expect(
      isPublishable(buildWorldSnapshot(source, { ...relations, factions: [] }))
    ).toBe(true)
  })

  it('refuses a world with neither', () => {
    // Not a setting anyone can start from — an empty campaign. Refused at
    // publish time so the person who can fix it (play more, then publish)
    // hears about it, rather than the first stranger who forks it.
    expect(
      isPublishable(buildWorldSnapshot(source, { ...relations, factions: [], capabilities: [] }))
    ).toBe(false)
  })
})

describe('reading a snapshot back', () => {
  it('round-trips into the bundle creation takes', () => {
    const pre = snapshotToPreGenerated(buildWorldSnapshot(source, relations))

    expect(pre).not.toBeNull()
    expect(pre!.worldSeed).toBe('The pass has been closed since autumn.')
    expect(pre!.factions).toHaveLength(1)
    expect(pre!.capabilities).toHaveLength(1)
    expect(pre!.worldExtras!.archetypes).toHaveLength(1)
    expect(pre!.worldExtras!.corruptionTheme).toEqual({ name: 'The Rot' })
    expect(pre!.calendar).toEqual({ months: [] })
  })

  it('refuses a version it does not know', () => {
    // Guessing would seed a campaign from fields it had misread.
    expect(snapshotToPreGenerated({ version: 2, factions: [] })).toBeNull()
  })

  it('refuses anything that is not a snapshot object', () => {
    expect(snapshotToPreGenerated(null)).toBeNull()
    expect(snapshotToPreGenerated('nope')).toBeNull()
    expect(snapshotToPreGenerated([])).toBeNull()
    expect(snapshotToPreGenerated({})).toBeNull()
  })

  it('reports a missing advancement track as declined, not as a failure', () => {
    // 'declined' is the outcome meaning "this universe has no ranks", which
    // is the truthful reading of a snapshot carrying no track. Reporting a
    // generation failure instead would turn an absence into a fault.
    const snapshot = buildWorldSnapshot({ ...source, advancementTrack: null }, relations)
    expect(snapshotToPreGenerated(snapshot)!.worldExtras!.advancementTrackOutcome).toBe('declined')
  })

  it('tolerates array fields that arrived as something else', () => {
    // A hand-edited or older row must degrade to an empty list rather than
    // throwing somewhere deep inside seeding.
    const pre = snapshotToPreGenerated({ version: 1, factions: 'not-a-list', capabilities: null })
    expect(pre!.factions).toEqual([])
    expect(pre!.capabilities).toEqual([])
  })
})

describe('slugs', () => {
  it('slugifies an ordinary title', () => {
    expect(slugifyTitle('The Long Winter')).toBe('the-long-winter')
  })

  it('keeps accented letters as their base letter rather than dropping them', () => {
    expect(slugifyTitle('Ásgard Falling')).toBe('asgard-falling')
  })

  it('collapses punctuation and trims the edges', () => {
    expect(slugifyTitle('  ...Winter!!  Comes??  ')).toBe('winter-comes')
  })

  it('refuses a title with nothing usable in it', () => {
    // Null rather than a random fallback: a world whose whole address is a
    // random suffix is worse to share than one the author is asked to
    // retitle.
    expect(slugifyTitle('!!!')).toBeNull()
    expect(slugifyTitle('   ')).toBeNull()
  })

  it('refuses a slug that would collide with a route of its own', () => {
    expect(slugifyTitle('New')).toBeNull()
    expect(slugifyTitle('api')).toBeNull()
  })

  it('never ends in a dash after truncation', () => {
    const slug = slugifyTitle('a'.repeat(58) + ' bb')
    expect(slug).not.toMatch(/-$/)
  })
})
