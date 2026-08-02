// src/lib/game/tick/__tests__/orchestration.test.ts
//
// `runWorldTick` itself (#96) — which no test executed.
//
// Every pure decider in this directory is thoroughly covered, and the
// handlers get some coverage too, but the file that owns the ORDER had
// zero test references. That order is the substance of the design: a
// 25-line comment in worldTick.ts explains five same-turn dependencies
// that only hold because the handlers run in a specific sequence. It was
// enforced by nothing. Reordering TICK_HANDLERS broke the simulation
// silently and left the suite green.
//
// The handlers are stubbed on purpose. runWorldTick's job is orchestration
// — sequence, accumulation, the dry-run short-circuit, and the fan-out to
// the three consumers — and stubbing lets each of those be asserted
// exactly, without rebuilding a plausible database. The faction/war/NPC
// rules themselves are tested in tick.test.ts against their pure forms.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted above module-level consts, so everything
// they close over has to be built inside vi.hoisted.
const h = vi.hoisted(() => {
  const callOrder: string[] = []
  const pendingAmbition = { factionId: 'f1', factionName: 'Ashcrown' }

  /**
   * A stub handler that logs its own name and reports one change, so the
   * orchestrator's accumulation is observable per handler rather than only
   * in aggregate.
   */
  const stub = (name: string, extra: Record<string, unknown> = {}) =>
    vi.fn(async (ctx: { campaignId: string }) => {
      callOrder.push(name)
      return {
        changes: [{
          entityType: 'FACTION',
          entityId: `${name}-entity`,
          entityName: name,
          campaignId: ctx.campaignId,
          field: name,
          previousValue: 0,
          newValue: 1,
          reason: `${name} ran`,
          significant: true,
          importance: 'NORMAL',
        }],
        ...extra,
      }
    })

  return {
    callOrder,
    pendingAmbition,
    stub,
    persistWorldEvents: vi.fn(async () => {}),
    logSignificantChanges: vi.fn(async () => 3),
    syncWikiEntriesForChanges: vi.fn(async () => {}),
  }
})

const { callOrder, pendingAmbition } = h
const { persistWorldEvents, logSignificantChanges, syncWikiEntriesForChanges } = h

vi.mock('../weatherTick', () => ({ tickWeather: h.stub('weather') }))
vi.mock('../seasonTick', () => ({ tickSeasonalPressure: h.stub('season') }))
vi.mock('../relationshipTick', () => ({ tickFactionRelationships: h.stub('relationships') }))
vi.mock('../beliefTick', () => ({ tickBeliefDrift: h.stub('beliefDrift') }))
vi.mock('../factionTick', () => ({ tickFactions: h.stub('factions') }))
vi.mock('../leadershipTick', () => ({ tickFactionLeadership: h.stub('leadership') }))
vi.mock('../warTick', () => ({ tickWars: h.stub('wars') }))
vi.mock('../locationConditionTick', () => ({ tickLocationCondition: h.stub('locationCondition') }))
vi.mock('../logisticsTick', () => ({ tickLogistics: h.stub('logistics') }))
vi.mock('../ambitionTick', () => ({
  tickFactionAmbitions: h.stub('ambitions', { pendingAmbitions: [h.pendingAmbition] }),
}))
vi.mock('../npcTick', () => ({ tickNpcs: h.stub('npcs') }))
vi.mock('../migrationTick', () => ({ tickMigration: h.stub('migration') }))
vi.mock('../npcSocietyTick', () => ({
  tickNpcSocialTies: h.stub('socialTies'),
  tickNpcJointSchemes: h.stub('jointSchemes'),
}))
vi.mock('../wakeTick', () => ({ tickWake: h.stub('wake') }))
vi.mock('../integrityTick', () => ({ tickIntegrity: h.stub('integrity') }))

vi.mock('../worldEventLog', () => ({ persistWorldEvents: h.persistWorldEvents }))
vi.mock('../historyLog', () => ({ logSignificantChanges: h.logSignificantChanges }))
vi.mock('../wikiSync', () => ({ syncWikiEntriesForChanges: h.syncWikiEntriesForChanges }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    worldMeta: { findUnique: vi.fn(async () => ({ factionCap: 12, npcCap: 30 })) },
    // Phase 3: runWorldTick wraps every handler in one transaction on a
    // real (non-dry-run) tick. The stub handlers above never touch `tx`
    // themselves, so a bare pass-through is enough here.
    $transaction: vi.fn(async (fn: any) => fn({})),
  },
}))

import { runWorldTick } from '../../worldTick'
import { prisma } from '@/lib/prisma'

beforeEach(() => {
  callOrder.length = 0
  // clearAllMocks, not resetAllMocks: call history has to be per-test (the
  // ordering assertions read calls[0]) while the stub implementations must
  // survive, since reset would strip them and every handler would return
  // undefined.
  vi.clearAllMocks()
  ;(prisma.worldMeta.findUnique as any).mockResolvedValue({ factionCap: 12, npcCap: 30 })
})

/** Index of a handler in the observed run order. */
const at = (name: string) => callOrder.indexOf(name)

describe('runWorldTick — the handler sequence', () => {
  it('runs every registered handler exactly once', async () => {
    await runWorldTick('camp1', 7)

    expect(callOrder).toHaveLength(16)
    expect(new Set(callOrder).size).toBe(16)
  })

  // Each case below is one of the five same-turn dependencies documented
  // in worldTick.ts. Asserted as PAIRWISE constraints rather than by
  // comparing the whole array to a literal list, so inserting a tenth
  // handler doesn't fail a test it has nothing to do with — while
  // genuinely breaking a dependency still does.

  it('updates relationships BEFORE factions, so goal reassessment reads this turn\'s rivalries', async () => {
    // relationshipTick writes from the previous turn's goals; factionTick
    // then reads a fresh relationship to decide whether DESTABILIZE_RIVAL
    // is even reachable. Swap these and that check reads stale data.
    await runWorldTick('camp1', 7)
    expect(at('relationships')).toBeLessThan(at('factions'))
  })

  it('runs belief drift right after relationships and before factions, so goal reassessment reads this turn\'s belief', async () => {
    // tickBeliefDrift (#104) updates Faction.beliefVector from the prior
    // turn's WorldEvent history; tickFactions's goal reassessment then
    // reads the freshly-drifted belief the same turn it changed.
    await runWorldTick('camp1', 7)
    expect(at('relationships')).toBeLessThan(at('beliefDrift'))
    expect(at('beliefDrift')).toBeLessThan(at('factions'))
  })

  it('promotes leadership AFTER factions, so a collapse can be succeeded the same turn', async () => {
    // When a faction collapses and its members defect to a rival,
    // leadershipTick can give that rival a leader immediately instead of
    // leaving it leaderless for a full turn.
    await runWorldTick('camp1', 7)
    expect(at('factions')).toBeLessThan(at('leadership'))
  })

  it('runs wars after faction drift and leadership, so momentum reads current strength', async () => {
    await runWorldTick('camp1', 7)
    expect(at('leadership')).toBeLessThan(at('wars'))
    expect(at('factions')).toBeLessThan(at('wars'))
  })

  it('runs wars BEFORE ambitions, so a faction going to war this tick is skipped for ambitions', async () => {
    // ambitionTick skips any faction with a WarParticipant row in an
    // ESCALATING war. Running wars first means the rows exist by the time
    // ambitions are weighed, so nobody commits to an unrelated ambition
    // the same tick they go to war.
    await runWorldTick('camp1', 7)
    expect(at('wars')).toBeLessThan(at('ambitions'))
  })

  it('runs location condition right after wars, so a war resolved this tick no longer counts as "at war"', async () => {
    await runWorldTick('camp1', 7)
    expect(at('wars')).toBeLessThan(at('locationCondition'))
  })

  it('runs logistics right after location condition and before ambitions, so a lifted blockade and its resource gain both land this same turn', async () => {
    // tickLogistics (#106) reads the same ESCALATING-war signal
    // tickLocationCondition already reads, and must land before ambitions
    // so a faction's logistics-driven resource gain is visible to
    // ambition commitment's resource threshold the same turn.
    await runWorldTick('camp1', 7)
    expect(at('locationCondition')).toBeLessThan(at('logistics'))
    expect(at('logistics')).toBeLessThan(at('ambitions'))
  })

  it('derives NPC ties after NPCs move, then schemes from those ties, all in one pass', async () => {
    // Ties derive from faction/NPC state; schemes then use the ties this
    // turn established rather than waiting an extra tick.
    await runWorldTick('camp1', 7)
    expect(at('npcs')).toBeLessThan(at('socialTies'))
    expect(at('socialTies')).toBeLessThan(at('jointSchemes'))
  })

  it('runs migration right after NPCs move, so a distressed location reflects this turn\'s post-commute residents', async () => {
    // tickMigration (#110) reads each NPC's currentLocation as of THIS
    // turn's tickNpcs pass, not last turn's, and depends on
    // tickLocationCondition's conditionScore from earlier in the same pass.
    await runWorldTick('camp1', 7)
    expect(at('npcs')).toBeLessThan(at('migration'))
    expect(at('locationCondition')).toBeLessThan(at('migration'))
  })

  it('runs wake right before integrity, after factions/leadership have recorded this turn\'s roughness', async () => {
    // tickWake (#103) reads ctx.collapseRoughnessByFactionId/
    // ctx.successionRoughnessByFactionId, set by tickFactions/
    // tickFactionLeadership earlier in this same pass.
    await runWorldTick('camp1', 7)
    expect(at('factions')).toBeLessThan(at('wake'))
    expect(at('leadership')).toBeLessThan(at('wake'))
    expect(at('wake')).toBeLessThan(at('integrity'))
  })

  it('validates integrity LAST, after every other handler has written', async () => {
    // tickIntegrity checks the state this turn actually produced — it has
    // to see every other handler's writes, not last turn's.
    await runWorldTick('camp1', 7)
    for (const name of ['weather', 'season', 'relationships', 'beliefDrift', 'factions', 'leadership', 'wars', 'locationCondition', 'logistics', 'ambitions', 'npcs', 'migration', 'socialTies', 'jointSchemes', 'wake']) {
      expect(at(name)).toBeLessThan(at('integrity'))
    }
  })
})

describe('runWorldTick — context and accumulation', () => {
  it('resolves caps once and hands the same context to every handler', async () => {
    const { tickWeather } = await import('../weatherTick')
    const { tickNpcs } = await import('../npcTick')
    await runWorldTick('camp1', 7)

    expect(prisma.worldMeta.findUnique).toHaveBeenCalledTimes(1)
    const expected = { campaignId: 'camp1', turnNumber: 7, factionCap: 12, npcCap: 30, dryRun: false }
    expect((tickWeather as any).mock.calls[0][0]).toMatchObject(expected)
    expect((tickNpcs as any).mock.calls[0][0]).toMatchObject(expected)
  })

  it('falls back to default caps when a campaign has no WorldMeta row', async () => {
    ;(prisma.worldMeta.findUnique as any).mockResolvedValue(null)
    const { tickWeather } = await import('../weatherTick')

    await runWorldTick('camp1', 7)

    const ctx = (tickWeather as any).mock.calls.at(-1)[0]
    expect(Number.isFinite(ctx.factionCap)).toBe(true)
    expect(ctx.factionCap).toBeGreaterThan(0)
  })

  it('collects every handler\'s changes, losing none', async () => {
    const result = await runWorldTick('camp1', 7)
    expect(result.changes).toHaveLength(16)
    expect(result.changes.map(c => c.field).sort()).toEqual([...callOrder].sort())
  })

  it('collects pendingAmbitions from the handlers that report them', async () => {
    // Only ambitionTick returns these, and the orchestrator has to thread
    // them out to the narration layer — dropping them means an earned
    // ambition silently goes nowhere.
    const result = await runWorldTick('camp1', 7)
    expect(result.pendingAmbitions).toEqual([pendingAmbition])
  })

  it('reports the turn it was asked to run', async () => {
    const result = await runWorldTick('camp1', 42)
    expect(result).toMatchObject({ campaignId: 'camp1', turnNumber: 42 })
    expect(result.timestamp).toBeInstanceOf(Date)
  })
})

describe('runWorldTick — the fan-out to all three consumers', () => {
  it('feeds the same accumulated changes to events, history and the wiki', async () => {
    // These three fan out from one array — the event-bus shape without a
    // pub/sub mechanism. A consumer receiving a different set than its
    // siblings is the failure mode worth pinning.
    await runWorldTick('camp1', 7)

    for (const consumer of [persistWorldEvents, logSignificantChanges, syncWikiEntriesForChanges]) {
      expect(consumer).toHaveBeenCalledTimes(1)
      const [campaignId, turnNumber, changes] = consumer.mock.calls[0] as any[]
      expect(campaignId).toBe('camp1')
      expect(turnNumber).toBe(7)
      expect(changes).toHaveLength(16)
    }
  })

  it('reports the history count from the logger rather than guessing it', async () => {
    const result = await runWorldTick('camp1', 7)
    expect(result.historyEntriesCreated).toBe(3)
  })
})

describe('runWorldTick — dry run', () => {
  it('still runs every handler, so the preview reflects real decisions', async () => {
    await runWorldTick('camp1', 7, { dryRun: true })
    expect(callOrder).toHaveLength(16)
  })

  it('tells every handler it is a dry run, since each skips its own writes', async () => {
    const { tickFactions } = await import('../factionTick')
    await runWorldTick('camp1', 7, { dryRun: true })
    expect((tickFactions as any).mock.calls.at(-1)[0].dryRun).toBe(true)
  })

  it('persists nothing at all', async () => {
    // The whole guarantee of the admin preview. If any of these fired, a
    // read-only preview would be writing world history.
    await runWorldTick('camp1', 7, { dryRun: true })

    expect(persistWorldEvents).not.toHaveBeenCalled()
    expect(logSignificantChanges).not.toHaveBeenCalled()
    expect(syncWikiEntriesForChanges).not.toHaveBeenCalled()
  })

  it('returns the changes it would have made, with a zeroed history count', async () => {
    const result = await runWorldTick('camp1', 7, { dryRun: true })
    expect(result.changes).toHaveLength(16)
    expect(result.historyEntriesCreated).toBe(0)
    expect(result.pendingAmbitions).toEqual([pendingAmbition])
  })
})
