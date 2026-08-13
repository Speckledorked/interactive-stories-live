// src/lib/game/tick/__tests__/wikiSync.test.ts
// WikiEntry.changelog (#90) — declared, initialized empty at creation, and
// never appended to by anything, so the wiki page's own
// `changelog.length > 0` display guard could never become true.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    location: { findUnique: vi.fn() },
    nPC: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    faction: { findUnique: vi.fn() },
    wikiEntry: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
  },
}))

import { prisma } from '@/lib/prisma'
import { appendWikiChangelog, MAX_WIKI_CHANGELOG_ENTRIES, humanizeArchetype, syncWikiEntriesForChanges } from '../wikiSync'
import type { WorldChange } from '../types'

const db = prisma as any

function npcChange(id: string): WorldChange {
  return {
    entityType: 'NPC', entityId: id, entityName: `NPC ${id}`, campaignId: 'camp1',
    field: 'goals', previousValue: 'a', newValue: 'b', reason: 'x',
    significant: true, importance: 'NORMAL',
  }
}

function baseNpc(id: string) {
  return {
    id, name: `NPC ${id}`, description: null, goals: null, relationship: null,
    currentPlan: null, importance: 3, isDiscovered: true, socialTies: null,
    faction: null, location: null,
  }
}

describe('appendWikiChangelog (#90)', () => {
  it('starts a changelog from nothing', () => {
    expect(appendWikiChangelog(null, 5, 'Details updated')).toEqual([{ turn: 5, change: 'Details updated' }])
    expect(appendWikiChangelog(undefined, 5, 'x')).toHaveLength(1)
  })

  it('appends to an existing changelog in order', () => {
    const first = appendWikiChangelog(null, 1, 'a')
    const second = appendWikiChangelog(first, 2, 'b')
    expect(second).toEqual([{ turn: 1, change: 'a' }, { turn: 2, change: 'b' }])
  })

  it('does not record the same no-op twice for the same turn', () => {
    // A tick can re-sync an unchanged entry; that shouldn't spam history.
    const first = appendWikiChangelog(null, 3, 'Details updated')
    const again = appendWikiChangelog(first, 3, 'Details updated')
    expect(again).toHaveLength(1)
  })

  it('does record the same text on a later turn', () => {
    const first = appendWikiChangelog(null, 3, 'Details updated')
    const later = appendWikiChangelog(first, 4, 'Details updated')
    expect(later).toHaveLength(2)
  })

  it('is bounded, dropping the oldest entries', () => {
    let log: any = null
    for (let turn = 1; turn <= MAX_WIKI_CHANGELOG_ENTRIES + 10; turn++) {
      log = appendWikiChangelog(log, turn, `change ${turn}`)
    }
    expect(log).toHaveLength(MAX_WIKI_CHANGELOG_ENTRIES)
    expect(log[log.length - 1].turn).toBe(MAX_WIKI_CHANGELOG_ENTRIES + 10)
    expect(log[0].turn).toBe(11)
  })

  it('ignores malformed prior content rather than throwing', () => {
    expect(appendWikiChangelog('not an array', 1, 'a')).toEqual([{ turn: 1, change: 'a' }])
    expect(appendWikiChangelog([null, { nope: true }], 1, 'a')).toEqual([{ turn: 1, change: 'a' }])
  })
})

describe('humanizeArchetype', () => {
  it('turns a single-word enum value into title case', () => {
    expect(humanizeArchetype('MILITARY')).toBe('Military')
    expect(humanizeArchetype('GENERIC')).toBe('Generic')
  })

  it('turns a multi-word SCREAMING_SNAKE_CASE value into spaced title case', () => {
    expect(humanizeArchetype('SECRET_SOCIETY')).toBe('Secret Society')
  })
})

// #236 (adversarial audit): syncWikiEntriesForChanges used to have no
// per-entity error isolation — one entity's DB failure threw straight out
// of the whole function, and worldTick.ts awaited it with nothing
// catching it, so a single bad wiki sync could abort the rest of that
// world turn's processing even though the tick's own simulation-state
// transaction had already committed.
describe('syncWikiEntriesForChanges — per-entity error isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.wikiEntry.findFirst.mockResolvedValue(null)
    db.wikiEntry.create.mockResolvedValue({})
    db.nPC.findMany.mockResolvedValue([])
  })

  it('does not throw when one entity errors, and still syncs the rest', async () => {
    db.nPC.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 'npc-bad') throw new Error('connection reset')
      return baseNpc(where.id)
    })

    const synced = await syncWikiEntriesForChanges('camp1', 5, [npcChange('npc-bad'), npcChange('npc-good')])

    expect(synced).toBe(1)
    expect(db.wikiEntry.create).toHaveBeenCalledTimes(1)
    expect(db.wikiEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'NPC npc-good' }) })
    )
  })

  it('syncs every entity when none of them error', async () => {
    db.nPC.findUnique.mockImplementation(async ({ where }: any) => baseNpc(where.id))

    const synced = await syncWikiEntriesForChanges('camp1', 5, [npcChange('npc-a'), npcChange('npc-b')])

    expect(synced).toBe(2)
    expect(db.wikiEntry.create).toHaveBeenCalledTimes(2)
  })

  it('a failure partway through does not corrupt state for entities synced before it', async () => {
    db.nPC.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 'npc-b') throw new Error('db down')
      return baseNpc(where.id)
    })

    const synced = await syncWikiEntriesForChanges('camp1', 5, [npcChange('npc-a'), npcChange('npc-b'), npcChange('npc-c')])

    expect(synced).toBe(2)
  })
})
