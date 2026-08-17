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
vi.mock('../npcDispositionTick', () => ({ tickNpcDisposition: h.stub('npcDisposition') }))
vi.mock('../factionTick', () => ({ tickFactions: h.stub('factions') }))
vi.mock('../leadershipTick', () => ({ tickFactionLeadership: h.stub('leadership') }))
vi.mock('../warTick', () => ({ tickWars: h.stub('wars') }))
vi.mock('../territoryLoyaltyTick', () => ({ tickTerritoryLoyalty: h.stub('territoryLoyalty') }))
vi.mock('../locationConditionTick', () => ({ tickLocationCondition: h.stub('locationCondition') }))
vi.mock('../logisticsTick', () => ({ tickLogistics: h.stub('logistics') }))
vi.mock('../ambitionTick', () => ({
  tickFactionAmbitions: h.stub('ambitions', { pendingAmbitions: [h.pendingAmbition] }),
}))
vi.mock('../npcTick', () => ({ tickNpcs: h.stub('npcs'), MAJOR_IMPORTANCE_THRESHOLD: 4 }))
vi.mock('../migrationTick', () => ({ tickMigration: h.stub('migration') }))
vi.mock('../informationTick', () => ({ tickInformation: h.stub('information') }))
vi.mock('../npcSocietyTick', () => ({
  tickNpcSocialTies: h.stub('socialTies'),
  tickNpcJointSchemes: h.stub('jointSchemes'),
}))
vi.mock('../wakeTick', () => ({ tickWake: h.stub('wake') }))
vi.mock('../economyTick', () => ({ tickEconomy: h.stub('economy') }))
vi.mock('../integrityTick', () => ({ tickIntegrity: h.stub('integrity') }))

vi.mock('../worldEventLog', () => ({ persistWorldEvents: h.persistWorldEvents }))
vi.mock('../historyLog', () => ({ logSignificantChanges: h.logSignificantChanges }))
vi.mock('../wikiSync', () => ({ syncWikiEntriesForChanges: h.syncWikiEntriesForChanges }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    worldMeta: { findUnique: vi.fn(async () => ({ factionCap: 12, npcCap: 30 })), updateMany: vi.fn() },
    // #375: the tick resolves its entity roster once, before the
    // transaction opens (see capOrdering.ts) — these back that query.
    faction: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
    nPC: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
    // Phase 3: runWorldTick wraps every handler in one transaction on a
    // real (non-dry-run) tick. The stub handlers above never touch `tx`
    // themselves, but the tick itself now bumps the rotation key and the
    // simulation turn through it at the end of the pass.
    $transaction: vi.fn(async (fn: any) =>
      fn({
        faction: { updateMany: vi.fn() },
        nPC: { updateMany: vi.fn() },
        worldMeta: { updateMany: vi.fn() },
      })
    ),
  },
}))

import { runWorldTick } from '../../worldTick'
import { prisma } from '@/lib/prisma'
import { simTurn } from '@/lib/game/turnClock'

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
    await runWorldTick('camp1', simTurn(7))

    expect(callOrder).toHaveLength(20)
    expect(new Set(callOrder).size).toBe(20)
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
    await runWorldTick('camp1', simTurn(7))
    expect(at('relationships')).toBeLessThan(at('factions'))
  })

  it('runs belief drift right after relationships and before factions, so goal reassessment reads this turn\'s belief', async () => {
    // tickBeliefDrift (#104) updates Faction.beliefVector from the prior
    // turn's WorldEvent history; tickFactions's goal reassessment then
    // reads the freshly-drifted belief the same turn it changed.
    await runWorldTick('camp1', simTurn(7))
    expect(at('relationships')).toBeLessThan(at('beliefDrift'))
    expect(at('beliefDrift')).toBeLessThan(at('factions'))
  })

  it('runs NPC disposition drift right after belief drift and before factions/leadership, so their loyalty/ambition consumers read this turn\'s freshly-drifted value', async () => {
    // tickNpcDisposition updates NPC.disposition from the prior turn's
    // WorldEvent history; tickFactions' collapse-defection split (loyalty)
    // and tickFactionLeadership's succession scoring (ambition) then both
    // read the freshly-drifted disposition the same turn it changed.
    await runWorldTick('camp1', simTurn(7))
    expect(at('beliefDrift')).toBeLessThan(at('npcDisposition'))
    expect(at('npcDisposition')).toBeLessThan(at('factions'))
    expect(at('npcDisposition')).toBeLessThan(at('leadership'))
  })

  it('promotes leadership AFTER factions, so a collapse can be succeeded the same turn', async () => {
    // When a faction collapses and its members defect to a rival,
    // leadershipTick can give that rival a leader immediately instead of
    // leaving it leaderless for a full turn.
    await runWorldTick('camp1', simTurn(7))
    expect(at('factions')).toBeLessThan(at('leadership'))
  })

  it('runs wars after faction drift and leadership, so momentum reads current strength', async () => {
    await runWorldTick('camp1', simTurn(7))
    expect(at('leadership')).toBeLessThan(at('wars'))
    expect(at('factions')).toBeLessThan(at('wars'))
  })

  it('runs wars BEFORE ambitions, so a faction going to war this tick is skipped for ambitions', async () => {
    // ambitionTick skips any faction with a WarParticipant row in an
    // ESCALATING war. Running wars first means the rows exist by the time
    // ambitions are weighed, so nobody commits to an unrelated ambition
    // the same tick they go to war.
    await runWorldTick('camp1', simTurn(7))
    expect(at('wars')).toBeLessThan(at('ambitions'))
  })

  it('runs location condition right after wars, so a war resolved this tick no longer counts as "at war"', async () => {
    await runWorldTick('camp1', simTurn(7))
    expect(at('wars')).toBeLessThan(at('locationCondition'))
  })

  it('runs territory loyalty right after wars and before location condition, so a war-driven ownership flip lands this same turn (#119)', async () => {
    // tickTerritoryLoyalty reads post-war ownership (a war resolving this
    // tick can transfer a location), and a loyalty-driven flip this same
    // turn must be visible to tickLocationCondition's own war-presence
    // check, not lag a full extra turn.
    await runWorldTick('camp1', simTurn(7))
    expect(at('wars')).toBeLessThan(at('territoryLoyalty'))
    expect(at('territoryLoyalty')).toBeLessThan(at('locationCondition'))
  })

  it('runs logistics right after location condition and before ambitions, so a lifted blockade and its resource gain both land this same turn', async () => {
    // tickLogistics (#106) reads the same ESCALATING-war signal
    // tickLocationCondition already reads, and must land before ambitions
    // so a faction's logistics-driven resource gain is visible to
    // ambition commitment's resource threshold the same turn.
    await runWorldTick('camp1', simTurn(7))
    expect(at('locationCondition')).toBeLessThan(at('logistics'))
    expect(at('logistics')).toBeLessThan(at('ambitions'))
  })

  it('derives NPC ties after NPCs move, then schemes from those ties, all in one pass', async () => {
    // Ties derive from faction/NPC state; schemes then use the ties this
    // turn established rather than waiting an extra tick.
    await runWorldTick('camp1', simTurn(7))
    expect(at('npcs')).toBeLessThan(at('socialTies'))
    expect(at('socialTies')).toBeLessThan(at('jointSchemes'))
  })

  it('runs migration right after NPCs move, so a distressed location reflects this turn\'s post-commute residents', async () => {
    // tickMigration (#110) reads each NPC's currentLocation as of THIS
    // turn's tickNpcs pass, not last turn's, and depends on
    // tickLocationCondition's conditionScore from earlier in the same pass.
    await runWorldTick('camp1', simTurn(7))
    expect(at('npcs')).toBeLessThan(at('migration'))
    expect(at('locationCondition')).toBeLessThan(at('migration'))
  })

  it('runs wake right before economy, after factions/leadership have recorded this turn\'s roughness', async () => {
    // tickWake (#103) reads ctx.collapseRoughnessByFactionId/
    // ctx.successionRoughnessByFactionId, set by tickFactions/
    // tickFactionLeadership earlier in this same pass.
    await runWorldTick('camp1', simTurn(7))
    expect(at('factions')).toBeLessThan(at('wake'))
    expect(at('leadership')).toBeLessThan(at('wake'))
    expect(at('wake')).toBeLessThan(at('economy'))
  })

  it('runs economy right after wake, so a cascade\'s new ActiveWake row isn\'t decayed the same turn it was born', async () => {
    // tickEconomy (#111) creates its own ActiveWake rows (cascading
    // defaults) and must run AFTER tickWake's own decay phase this same
    // tick, or its fresh row would get decayed the same turn it was born.
    await runWorldTick('camp1', simTurn(7))
    expect(at('wake')).toBeLessThan(at('economy'))
    expect(at('economy')).toBeLessThan(at('integrity'))
  })

  it('validates integrity LAST, after every other handler has written', async () => {
    // tickIntegrity checks the state this turn actually produced — it has
    // to see every other handler's writes, not last turn's.
    await runWorldTick('camp1', simTurn(7))
    for (const name of ['weather', 'season', 'relationships', 'beliefDrift', 'npcDisposition', 'factions', 'leadership', 'wars', 'territoryLoyalty', 'locationCondition', 'logistics', 'ambitions', 'npcs', 'migration', 'information', 'socialTies', 'jointSchemes', 'wake', 'economy']) {
      expect(at(name)).toBeLessThan(at('integrity'))
    }
  })
})

describe('runWorldTick — context and accumulation', () => {
  it('resolves caps once and hands the same context to every handler', async () => {
    const { tickWeather } = await import('../weatherTick')
    const { tickNpcs } = await import('../npcTick')
    await runWorldTick('camp1', simTurn(7))

    expect(prisma.worldMeta.findUnique).toHaveBeenCalledTimes(1)
    const expected = { campaignId: 'camp1', turnNumber: 7, factionCap: 12, npcCap: 30, dryRun: false }
    expect((tickWeather as any).mock.calls[0][0]).toMatchObject(expected)
    expect((tickNpcs as any).mock.calls[0][0]).toMatchObject(expected)
  })

  it('falls back to default caps when a campaign has no WorldMeta row', async () => {
    ;(prisma.worldMeta.findUnique as any).mockResolvedValue(null)
    const { tickWeather } = await import('../weatherTick')

    await runWorldTick('camp1', simTurn(7))

    const ctx = (tickWeather as any).mock.calls.at(-1)[0]
    expect(Number.isFinite(ctx.factionCap)).toBe(true)
    expect(ctx.factionCap).toBeGreaterThan(0)
  })

  it('collects every handler\'s changes, losing none', async () => {
    const result = await runWorldTick('camp1', simTurn(7))
    expect(result.changes).toHaveLength(20)
    expect(result.changes.map(c => c.field).sort()).toEqual([...callOrder].sort())
  })

  it('collects pendingAmbitions from the handlers that report them', async () => {
    // Only ambitionTick returns these, and the orchestrator has to thread
    // them out to the narration layer — dropping them means an earned
    // ambition silently goes nowhere.
    const result = await runWorldTick('camp1', simTurn(7))
    expect(result.pendingAmbitions).toEqual([pendingAmbition])
  })

  it('reports the turn it was asked to run', async () => {
    const result = await runWorldTick('camp1', simTurn(42))
    expect(result).toMatchObject({ campaignId: 'camp1', turnNumber: 42 })
    expect(result.timestamp).toBeInstanceOf(Date)
  })
})

describe('runWorldTick — the fan-out to all three consumers', () => {
  it('feeds the same accumulated changes to events, history and the wiki', async () => {
    // These three fan out from one array — the event-bus shape without a
    // pub/sub mechanism. A consumer receiving a different set than its
    // siblings is the failure mode worth pinning.
    await runWorldTick('camp1', simTurn(7))

    for (const consumer of [persistWorldEvents, logSignificantChanges, syncWikiEntriesForChanges]) {
      expect(consumer).toHaveBeenCalledTimes(1)
      const [campaignId, turnNumber, changes] = consumer.mock.calls[0] as any[]
      expect(campaignId).toBe('camp1')
      expect(turnNumber).toBe(7)
      expect(changes).toHaveLength(20)
    }
  })

  it('reports the history count from the logger rather than guessing it', async () => {
    const result = await runWorldTick('camp1', simTurn(7))
    expect(result.historyEntriesCreated).toBe(3)
  })
})

// #236 (adversarial audit): these three post-commit consumers are
// documented as best-effort — a failure in one must not prevent the
// others from running, and must not propagate up to abort the rest of
// the world turn (advanceClocks, offscreen narration, chronicle
// generation, all called right after runWorldTick returns). Before this
// fix, an unexpected throw from any of the three propagated straight out
// of runWorldTick uncaught.
describe('runWorldTick — post-commit consumer resilience', () => {
  it('still calls history and wiki sync when persistWorldEvents throws unexpectedly', async () => {
    persistWorldEvents.mockRejectedValueOnce(new Error('db down'))
    const result = await runWorldTick('camp1', simTurn(7))
    expect(logSignificantChanges).toHaveBeenCalledTimes(1)
    expect(syncWikiEntriesForChanges).toHaveBeenCalledTimes(1)
    expect(result.campaignId).toBe('camp1')
  })

  it('still calls wiki sync and reports zero history when logSignificantChanges throws unexpectedly', async () => {
    logSignificantChanges.mockRejectedValueOnce(new Error('embedding service down'))
    const result = await runWorldTick('camp1', simTurn(7))
    expect(syncWikiEntriesForChanges).toHaveBeenCalledTimes(1)
    expect(result.historyEntriesCreated).toBe(0)
  })

  it('does not throw when syncWikiEntriesForChanges fails unexpectedly, and still reports the real history count', async () => {
    syncWikiEntriesForChanges.mockRejectedValueOnce(new Error('db down'))
    const result = await runWorldTick('camp1', simTurn(7))
    expect(result.historyEntriesCreated).toBe(3)
  })

  it('a failure in one consumer does not prevent a later call from behaving normally', async () => {
    persistWorldEvents.mockRejectedValueOnce(new Error('transient'))
    await runWorldTick('camp1', simTurn(7))
    persistWorldEvents.mockClear()

    const result = await runWorldTick('camp1', simTurn(8))
    expect(persistWorldEvents).toHaveBeenCalledTimes(1)
    expect(result.historyEntriesCreated).toBe(3)
  })
})

describe('runWorldTick — ctx.season wiring (#263)', () => {
  it('resolves season from worldMeta.totalElapsedGameHours and passes it to every handler via ctx', async () => {
    // 200 days in, no calendarConfig -> falls back to DEFAULT_CALENDAR.
    // Exact season value isn't the point here (calendar.test.ts already
    // covers deriveSeason's own math) - the point is ctx.season is
    // populated at all and consistent across handlers, not left undefined.
    ;(prisma.worldMeta.findUnique as any).mockResolvedValue({
      factionCap: 12, npcCap: 30, totalElapsedGameHours: 200 * 24, campaign: { calendarConfig: null },
    })
    const { tickWeather } = await import('../weatherTick')
    const { tickSeasonalPressure } = await import('../seasonTick')

    await runWorldTick('camp1', simTurn(7))

    const weatherCtx = (tickWeather as any).mock.calls[0][0]
    const seasonCtx = (tickSeasonalPressure as any).mock.calls[0][0]
    expect(weatherCtx.season).toBeDefined()
    expect(['spring', 'summer', 'autumn', 'winter']).toContain(weatherCtx.season)
    // Same ctx reference threaded through every handler in the pass.
    expect(seasonCtx.season).toBe(weatherCtx.season)
  })

  it('does not crash and leaves season resolvable even when worldMeta has no calendar fields at all', async () => {
    ;(prisma.worldMeta.findUnique as any).mockResolvedValue({ factionCap: 12, npcCap: 30 })
    const { tickWeather } = await import('../weatherTick')

    await expect(runWorldTick('camp1', simTurn(7))).resolves.toBeDefined()
    const weatherCtx = (tickWeather as any).mock.calls[0][0]
    expect(['spring', 'summer', 'autumn', 'winter']).toContain(weatherCtx.season)
  })
})

describe('runWorldTick — dry run', () => {
  it('still runs every handler, so the preview reflects real decisions', async () => {
    await runWorldTick('camp1', simTurn(7), { dryRun: true })
    expect(callOrder).toHaveLength(20)
  })

  it('tells every handler it is a dry run, since each skips its own writes', async () => {
    const { tickFactions } = await import('../factionTick')
    await runWorldTick('camp1', simTurn(7), { dryRun: true })
    expect((tickFactions as any).mock.calls.at(-1)[0].dryRun).toBe(true)
  })

  it('persists nothing at all', async () => {
    // The whole guarantee of the admin preview. If any of these fired, a
    // read-only preview would be writing world history.
    await runWorldTick('camp1', simTurn(7), { dryRun: true })

    expect(persistWorldEvents).not.toHaveBeenCalled()
    expect(logSignificantChanges).not.toHaveBeenCalled()
    expect(syncWikiEntriesForChanges).not.toHaveBeenCalled()
  })

  it('returns the changes it would have made, with a zeroed history count', async () => {
    const result = await runWorldTick('camp1', simTurn(7), { dryRun: true })
    expect(result.changes).toHaveLength(20)
    expect(result.historyEntriesCreated).toBe(0)
    expect(result.pendingAmbitions).toEqual([pendingAmbition])
  })
})
