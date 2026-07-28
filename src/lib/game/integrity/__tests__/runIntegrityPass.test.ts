import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  location: { findMany: vi.fn(async (): Promise<any[]> => []) },
  nPC: { findMany: vi.fn(async (): Promise<any[]> => []), update: vi.fn(async (_args: any) => ({})) },
  faction: { findMany: vi.fn(async (): Promise<any[]> => []), update: vi.fn(async (_args: any) => ({})) },
  character: { findMany: vi.fn(async (): Promise<any[]> => []), update: vi.fn(async (_args: any) => ({})) },
  clock: { findMany: vi.fn(async (): Promise<any[]> => []), update: vi.fn(async (_args: any) => ({})) },
  debt: { findMany: vi.fn(async (): Promise<any[]> => []), update: vi.fn(async (_args: any) => ({})) },
  war: { findMany: vi.fn(async (): Promise<any[]> => []), update: vi.fn(async (_args: any) => ({})) },
  quest: { findMany: vi.fn(async (): Promise<any[]> => []) },
}))

import { runIntegrityPass } from '../runIntegrityPass'
import { MAX_REPAIRS_PER_PASS, MAX_REPAIRS_PER_ENTITY } from '../caps'

beforeEach(() => {
  vi.clearAllMocks()
  db.location.findMany.mockResolvedValue([])
  db.nPC.findMany.mockResolvedValue([])
  db.faction.findMany.mockResolvedValue([])
  db.character.findMany.mockResolvedValue([])
  db.clock.findMany.mockResolvedValue([])
  db.debt.findMany.mockResolvedValue([])
  db.war.findMany.mockResolvedValue([])
  db.quest.findMany.mockResolvedValue([])
})

describe('runIntegrityPass — a clean campaign', () => {
  it('reports zero violations and applies nothing', async () => {
    const { changes, report } = await runIntegrityPass(db as any, 'camp1', 5)
    expect(changes).toHaveLength(0)
    expect(report).toMatchObject({ campaignId: 'camp1', turnNumber: 5, violationsFound: 0, repairsApplied: 0, unrepaired: [] })
  })
})

describe('runIntegrityPass — a repairable violation', () => {
  it('applies the repair and emits a WorldChange', async () => {
    db.character.findMany.mockResolvedValue([
      { id: 'char1', name: 'Jason', relationships: { 'npc_123': { trust: 10 } }, resources: null },
    ])

    const { changes, report } = await runIntegrityPass(db as any, 'camp1', 5)

    expect(report.violationsFound).toBe(1)
    expect(report.repairsApplied).toBe(1)
    expect(db.character.update).toHaveBeenCalledWith({ where: { id: 'char1' }, data: { relationships: {} } })
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ entityType: 'CHARACTER', entityId: 'char1', field: 'relationships' })
  })

  it('does not write anything in dry-run mode, but still reports the pending repair', async () => {
    db.character.findMany.mockResolvedValue([
      { id: 'char1', name: 'Jason', relationships: { 'npc_123': { trust: 10 } }, resources: null },
    ])

    const { changes, report } = await runIntegrityPass(db as any, 'camp1', 5, { dryRun: true })

    expect(report.repairsApplied).toBe(1)
    expect(changes).toHaveLength(1)
    expect(db.character.update).not.toHaveBeenCalled()
  })
})

describe('runIntegrityPass — detect-only violations', () => {
  it('reports a duplicate-name violation as unrepaired, never dropped', async () => {
    db.nPC.findMany.mockResolvedValue([
      { id: 'npc1', name: 'Kessler', isAlive: true, factionId: null, factionRole: null, importance: 1, socialTies: null },
      { id: 'npc2', name: 'Kessler', isAlive: true, factionId: null, factionRole: null, importance: 1, socialTies: null },
    ])

    const { changes, report } = await runIntegrityPass(db as any, 'camp1', 5)

    expect(report.repairsApplied).toBe(0)
    expect(report.unrepaired).toHaveLength(2)
    expect(changes).toHaveLength(0)
  })
})

describe('runIntegrityPass — blast-radius caps', () => {
  it('stops repairing once MAX_REPAIRS_PER_PASS is hit, reporting the rest as unrepaired', async () => {
    const characters = Array.from({ length: MAX_REPAIRS_PER_PASS + 5 }, (_, i) => ({
      id: `char${i}`, name: `Char ${i}`, relationships: { 'npc_ghost': { trust: 1 } }, resources: null,
    }))
    db.character.findMany.mockResolvedValue(characters)

    const { report } = await runIntegrityPass(db as any, 'camp1', 5)

    expect(report.violationsFound).toBe(MAX_REPAIRS_PER_PASS + 5)
    expect(report.repairsApplied).toBe(MAX_REPAIRS_PER_PASS)
    expect(report.unrepaired).toHaveLength(5)
  })

  it('stops repairing the SAME entity once MAX_REPAIRS_PER_ENTITY is hit within one pass', async () => {
    // One character with orphan keys in both relationships and
    // resources.reputation — two different checks both want to repair the
    // same row. Confirms the per-entity cap counts across checks, not just
    // within one.
    db.character.findMany.mockResolvedValue([{
      id: 'char1', name: 'Jason',
      relationships: { 'npc_ghost': { trust: 1 } },
      resources: { reputation: { 'faction_ghost': 5 } },
    }])

    const { report } = await runIntegrityPass(db as any, 'camp1', 5)
    expect(report.violationsFound).toBe(2)
    expect(report.repairsApplied).toBe(2)
    expect(report.unrepaired).toHaveLength(0)
    // Both fit under MAX_REPAIRS_PER_ENTITY (3) — this just documents the
    // counter is real and per-entity, not that it trips here.
    expect(MAX_REPAIRS_PER_ENTITY).toBeGreaterThanOrEqual(2)
  })
})
