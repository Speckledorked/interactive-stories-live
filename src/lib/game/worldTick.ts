// src/lib/game/worldTick.ts
// World Sim Phase 1 — the deterministic world tick.
//
// This is the single entry point every simulation system hooks into. It is
// pure and deterministic: it decides WHAT changed and WHY, then returns a
// structured list of changes. It never calls the AI. Narration of these
// changes into prose is entirely the job of the existing AI GM code
// (generateOffscreenEvents in worldTurnOffscreenEvents.ts, and the prompt
// builder in src/lib/ai/worldState.ts) — the AI narrates, the tick
// simulates. Keeping
// that boundary strict is the entire point of this system.
//
// Phase 2+ features (rumors, economy, ecology, ...) plug in by adding
// another handler to TICK_HANDLERS below. Nothing else about this file
// needs to change for that to work.
//
// Integrity Engine Phase 3: a real (non-dry-run) tick runs every handler
// inside one `prisma.$transaction`, via `ctx.db`. Previously a handler
// throwing partway through left the turn partially applied — the pacing
// accumulator that gated this turn had already been reset by the atomic
// claim in worldTurn.ts, so a partial failure silently lost the banked
// hours with no retry. Now a failed turn rolls back cleanly instead: every
// handler writes through `ctx.db` (never the bare `prisma` singleton), and
// worldTurn.ts restores the pacing accumulator when this throws.

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { tickWeather } from './tick/weatherTick'
import { tickSeasonalPressure } from './tick/seasonTick'
import { tickFactionRelationships } from './tick/relationshipTick'
import { tickBeliefDrift } from './tick/beliefTick'
import { tickNpcDisposition } from './tick/npcDispositionTick'
import { tickFactions } from './tick/factionTick'
import { tickFactionLeadership } from './tick/leadershipTick'
import { tickWars } from './tick/warTick'
import { tickTerritoryLoyalty } from './tick/territoryLoyaltyTick'
import { tickLocationCondition } from './tick/locationConditionTick'
import { tickLogistics } from './tick/logisticsTick'
import { tickFactionAmbitions } from './tick/ambitionTick'
import { tickNpcs, MAJOR_IMPORTANCE_THRESHOLD } from './tick/npcTick'
import { tickMigration } from './tick/migrationTick'
import { tickInformation } from './tick/informationTick'
import { tickNpcSocialTies, tickNpcJointSchemes } from './tick/npcSocietyTick'
import { tickWake } from './tick/wakeTick'
import { tickEconomy } from './tick/economyTick'
import { tickIntegrity } from './tick/integrityTick'
import { logSignificantChanges } from './tick/historyLog'
import { syncWikiEntriesForChanges } from './tick/wikiSync'
import { persistWorldEvents } from './tick/worldEventLog'
import { TickContext, TickHandler, WorldChange, WorldTickResult, PendingAmbition } from './tick/types'
import { resolveTickCaps, DEFAULT_FACTION_CAP, DEFAULT_NPC_CAP, type TickCapReport } from './tick/caps'
import { resolveTickRoster, markRosterTicked } from './tick/capOrdering'
import { deriveSeason, GeneratedCalendar } from './calendar'

// tickFactionRelationships runs BEFORE tickFactions on purpose: it reads
// each faction's goal as of the end of the previous turn and writes this
// turn's relationships from that, so tickFactions can then read a
// freshly-updated relationship for this same turn's goal reassessment
// (specifically, whether DESTABILIZE_RIVAL is reachable) without a circular
// same-turn dependency. See relationshipTick.ts for the full reasoning.
//
// tickBeliefDrift runs right after tickFactionRelationships and before
// tickFactions (#104): it reads each faction's own WorldEvent history from
// the immediately preceding turn (wars resolved, ambitions resolved, a
// wake ripple survived) and updates Faction.beliefVector, so
// tickFactions's goal reassessment reads this turn's freshly-drifted
// belief rather than stale data — same one-tick-lag shape as the
// relationships/goal pair above, just for a different input.
//
// tickNpcDisposition runs right after tickBeliefDrift and before
// tickFactions/tickFactionLeadership on purpose — same one-tick-lag shape
// as belief drift, individual-NPC-scoped instead of faction-scoped: it
// reads each major NPC's own WorldEvent history from the immediately
// preceding turn (a consequence dealt to them, a personal goal completed,
// their faction winning/losing a war or visibly abandoning them via a
// wake ripple) and updates NPC.disposition. Running before its two
// same-turn consumers — tickFactions' collapse-defection split (loyalty)
// and tickFactionLeadership's succession scoring (ambition) — means both
// read this turn's freshly-drifted disposition rather than stale data,
// same as tickBeliefDrift feeding tickFactions' goal reassessment.
// tickMigration (selfPreservation) runs much later in the pass and reads
// the same freshly-drifted value regardless of placement here.
//
// tickFactionLeadership runs right after tickFactions on purpose too: if a
// faction collapsed this turn and its members just defected to a rival (see
// factionTick.ts), this same-turn pass can immediately promote a new
// leader for that rival if it doesn't already have one, instead of leaving
// it leaderless until next turn.
//
// tickWars runs after both — it reads this turn's post-drift military and
// resources for momentum/attrition, and reads relationships/territory as of
// the start of this turn (one-tick lag, same reasoning as above). It runs
// before tickFactionAmbitions because ambitionTick explicitly skips any
// faction with a WarParticipant row in an ESCALATING war — running wars
// first means a war declared or joined THIS tick already has its
// participant rows by the time ambitions are weighed, so a faction never
// commits to an unrelated ambition the same tick it goes to war. (Ordering
// alone wouldn't guarantee that; the actual guard lives in ambitionTick.)
//
// tickNpcSocialTies runs right after tickNpcs and reads faction
// affiliation/relationships as of this same turn (no lag needed — unlike
// the faction pair above, NPC ties simply derive from faction state, they
// don't feed back into it). tickNpcJointSchemes runs immediately after
// that, in the same pass, so a scheme can use the ties this turn just
// established rather than waiting a full extra tick (see npcSocietyTick.ts).
// tickTerritoryLoyalty runs right after tickWars and before
// tickLocationCondition on purpose (#119): a war resolving THIS turn can
// flip a location's ownerFactionId (see warTick.ts's territory-transfer on
// resolution), so pushing loyalty afterward means it reads this turn's
// post-war owner, not last turn's. It runs before tickLocationCondition so
// a loyalty-driven ownership flip this same turn is what
// tickLocationCondition's own war-presence check sees, rather than lagging
// a full extra turn. This is the second real consumer of the generic Arc
// primitive (game/arc.ts) — the first being War.momentum itself, refactored
// in warTick.ts to delegate to the exact same push/resolve math. #228: it
// also excludes any location that's the live contestedLocationId of a
// still-ESCALATING war — wars own resolution for a location they're
// actively contesting, so this handler must never also flip its ownership
// out from under a war that hasn't resolved yet.
//
// tickLocationCondition runs right after tickWars on purpose (#109): it
// checks whether a location is currently the contested prize of an
// ESCALATING war, so a war that resolved THIS turn no longer counts as
// "at war" for this same pass rather than lagging a full extra turn.
//
// tickLogistics runs right after tickLocationCondition on purpose (#106):
// it reads the exact same ESCALATING-war-with-a-contestedLocationId signal
// to sync SupplyRoute.isBlockaded, so a war resolved THIS turn already
// lifts its blockade the same pass instead of lagging a full extra turn —
// and it runs before tickFactionAmbitions so a faction's logistics-driven
// resource gain this turn is visible to ambition commitment's resource
// threshold the same turn it lands, not one turn late.
//
// tickMigration runs right after tickNpcs on purpose (#110): it reads each
// NPC's post-commute currentLocation/locationId for this same turn (an NPC
// tickNpcs just moved OUT of a distressed location this tick is correctly
// exempt from fleeing it again), and it depends on tickLocationCondition's
// conditionScore from earlier in this same pass as its distress signal.
//
// tickInformation runs right after tickMigration on purpose (#101): an
// NPC-sourced significant WorldEvent's propagation origin uses that NPC's
// post-commute locationId for this same turn, not last turn's — the same
// freshness reasoning tickMigration itself documents above for reading
// tickNpcs' output. It has no same-tick ctx dependency on any other
// handler (it writes a silent EventWitness side-table, like
// PopulationFlightEvent, never a WorldChange), and it only ever reads
// WorldEvent rows already committed by a PRIOR turn's post-transaction
// persistWorldEvents call (see below) — this turn's own changes aren't
// WorldEvent rows yet while any handler is still running — so its exact
// position relative to every OTHER handler doesn't matter beyond this one
// freshness reason.
//
// tickWake runs right before tickEconomy (see below), after everything
// else has had a chance to collapse a faction or leave an NPC dead this
// same turn (#103): it reads ctx.collapseRoughnessByFactionId (set by
// tickFactions) and ctx.successionRoughnessByFactionId (set by
// tickFactionLeadership) earlier in this same pass, so it never
// recomputes "how rough was this transition" a second, independent way.
//
// tickEconomy runs right after tickWake, deliberately NOT before it
// (#111): it also reads ctx.collapseRoughnessByFactionId, and it creates
// its own ActiveWake rows (a cascading default's stability hit reuses
// #103's decay mechanism, tagged sourceType 'FACTION_DEFAULT'). tickWake's
// own decay phase runs unconditionally over every unresolved ActiveWake
// row each tick — if tickEconomy created one BEFORE tickWake ran this same
// pass, it would get decayed the same turn it was born, the exact
// same-tick double-count tickWake's own internal decay-before-create
// ordering exists to avoid. Running after sidesteps that entirely: a
// cascade created this turn starts decaying next turn, like every other
// wake.
//
// tickIntegrity runs LAST, deliberately: it validates the state every
// other handler above just produced (see game/integrity/ — the structural
// tier of the Integrity Engine), so it needs to see this turn's writes, not
// last turn's. See its own file for what it does and doesn't repair.
const TICK_HANDLERS: TickHandler[] = [tickWeather, tickSeasonalPressure, tickFactionRelationships, tickBeliefDrift, tickNpcDisposition, tickFactions, tickFactionLeadership, tickWars, tickTerritoryLoyalty, tickLocationCondition, tickLogistics, tickFactionAmbitions, tickNpcs, tickMigration, tickInformation, tickNpcSocialTies, tickNpcJointSchemes, tickWake, tickEconomy, tickIntegrity]

// Prisma's interactive-transaction default is 5s; this tick runs 10
// handlers' worth of queries against real (if capped-at-10/20) rosters, well
// past what that default budgets for. 20s leaves real headroom under the
// cron sweep's per-invocation budget while still failing fast if a handler
// is genuinely stuck rather than hanging the whole sweep.
//
// #203: this is a FLAT constant — it does not scale with factionCap/npcCap
// (tick/caps.ts), which are admin-settable per campaign. That's exactly why
// caps.ts's MAX_FACTION_CAP/MAX_NPC_CAP exist: the settings route enforces
// them so a raised cap can never grow the per-tick roster far enough to put
// real pressure on this fixed timeout, rather than this file silently
// depending on caps.ts staying small forever.
const TICK_TRANSACTION_TIMEOUT_MS = 20_000

/**
 * #407: the transaction budget scales with the roster it has to get
 * through.
 *
 * The 20s above was flat, while caps.ts allows an admin to raise
 * factionCap/npcCap to 5x the defaults — and caps.ts's own comment already
 * identifies that mismatch as the problem: a campaign whose caps are raised
 * far enough blows the budget and the ENTIRE world turn is lost (it fails
 * safe, but the turn does not happen).
 *
 * Scaled against the defaults so a default campaign is unchanged, and
 * clamped so a raised cap cannot buy an unbounded transaction — the point
 * is to keep a legitimately larger roster inside its budget, not to let a
 * stuck handler hang the whole cron sweep.
 */
function tickTimeoutFor(factionCap: number, npcCap: number): number {
  const rosterRatio = Math.max(
    1,
    (factionCap + npcCap) / (DEFAULT_FACTION_CAP + DEFAULT_NPC_CAP)
  )
  return Math.min(TICK_TRANSACTION_TIMEOUT_MS * rosterRatio, MAX_TICK_TRANSACTION_TIMEOUT_MS)
}

/**
 * Hard ceiling regardless of caps. The cron sweep's own per-invocation
 * budget is what this must stay well inside — a tick allowed to run longer
 * than the sweep can wait would be killed mid-turn anyway, which is
 * strictly worse than failing fast.
 */
const MAX_TICK_TRANSACTION_TIMEOUT_MS = 60_000

/**
 * Run one deterministic world tick for a campaign.
 *
 * Cadence: paced by IN-GAME time — runWorldTurnIfDue only invokes
 * runWorldTurn (and therefore this) once enough fictional hours have
 * accumulated from the AI's time_passage (default one in-game day; see
 * lib/game/tick/pacing.ts). There is no separate clock; this rides the
 * existing WorldMeta.currentTurnNumber progression instead of inventing
 * a new one.
 */
export async function runWorldTick(
  campaignId: string,
  turnNumber: number,
  options: { dryRun?: boolean } = {}
): Promise<WorldTickResult> {
  const dryRun = options.dryRun ?? false
  const worldMeta = await prisma.worldMeta.findUnique({
    where: { campaignId },
    select: {
      factionCap: true,
      npcCap: true,
      // #263: resolved once here so tickWeather can bias its transition
      // pick toward the season — see TickContext.season's own comment for
      // why tickSeasonalPressure's separate calendarConfig read is left
      // independent rather than refactored onto this.
      totalElapsedGameHours: true,
      campaign: { select: { calendarConfig: true } },
    },
  })
  const { factionCap, npcCap } = resolveTickCaps(worldMeta)
  const season = worldMeta
    ? deriveSeason(worldMeta.totalElapsedGameHours, (worldMeta.campaign?.calendarConfig as unknown as GeneratedCalendar) || null)
    : undefined

  // #375: WHICH entities this tick simulates is a tick-level decision, made
  // exactly once, here — not eleven times inside eleven handlers.
  //
  // Each handler used to run its own capped+rotated query and bump
  // lastTickedAt with the transaction client immediately afterwards. Prisma
  // transactions read their own writes, so handler N+1 saw handler N's
  // bump and selected a DIFFERENT slice: the same-tick chain this file's
  // header comment exists to protect (relationships → goal reassessment →
  // leadership → wars) ran on largely disjoint faction sets. It also made
  // the tick nondeterministic (new Date() as a selection key) and made
  // dry-run preview a different simulation than the real tick.
  //
  // Resolved BEFORE the transaction opens, so it reads committed state and
  // cannot see anything the tick itself writes.
  const roster = await resolveTickRoster(prisma, {
    campaignId,
    factionCap,
    npcCap,
    npcImportanceThreshold: MAJOR_IMPORTANCE_THRESHOLD,
  })
  if (roster.factionCapHit || roster.npcCapHit) {
    // #410: a cap that silently drops entities is a simulation that
    // silently stops happening. At minimum it is visible in the log; the
    // admin surface reads TickCapReport (see caps.ts).
    console.warn(
      `⚠️  Tick roster capped for ${campaignId}: ${roster.factionIds.length}/${factionCap} factions, ${roster.npcIds.length}/${npcCap} NPCs — entities beyond the cap do not advance this turn`
    )
  }

  // One timestamp for the whole tick's rotation bump, captured here rather
  // than read inside a handler, so no wall-clock read can influence what
  // the tick decides.
  const tickStartedAt = new Date()

  const changes: WorldChange[] = []
  const pendingAmbitions: PendingAmbition[] = []

  const runHandlers = async (db: TickContext['db']) => {
    const ctx: TickContext = {
      campaignId,
      turnNumber,
      factionCap,
      npcCap,
      roster,
      dryRun,
      db,
      // #402: the in-fiction clock. npcTick reads this for time of day
      // instead of turnNumber % 4 — see calendar.ts's timeOfDayFromHours.
      totalElapsedGameHours: worldMeta?.totalElapsedGameHours,
      // #103: same-tick scratch space tickFactions/tickFactionLeadership
      // write into and tickWake reads back out of — see its own comment
      // on TickContext for why.
      collapseRoughnessByFactionId: new Map(),
      successionRoughnessByFactionId: new Map(),
      season,
    }
    for (const handler of TICK_HANDLERS) {
      const result = await handler(ctx)
      changes.push(...result.changes)
      if (result.pendingAmbitions) pendingAmbitions.push(...result.pendingAmbitions)
    }

    // #375: rotate ONCE, after every handler, inside the same transaction —
    // so a tick that fails does not claim to have simulated anyone, and no
    // handler can see another handler's bump.
    //
    // #374: and advance the simulation's own turn counter here, for exactly
    // the same reason. This is the only place it moves: a world turn that
    // rolled back did not happen, and must not leave the counter claiming
    // it did.
    if (!dryRun) {
      await markRosterTicked(db as Prisma.TransactionClient, roster, tickStartedAt)

      // #410: record what this tick could NOT simulate, alongside the
      // turn it did. A cap that silently drops entities is a simulation
      // that silently stops happening for them — see TickCapReport.
      const capReport: TickCapReport = {
        at: tickStartedAt.toISOString(),
        simulationTurn: turnNumber,
        factionCap,
        npcCap,
        factionsSimulated: roster.factionIds.length,
        npcsSimulated: roster.npcIds.length,
        factionCapHit: roster.factionCapHit,
        npcCapHit: roster.npcCapHit,
      }
      await db.worldMeta.updateMany({
        where: { campaignId },
        data: {
          simulationTurn: turnNumber,
          lastTickCapReport: capReport as unknown as Prisma.InputJsonValue,
        },
      })
    }
  }

  if (dryRun) {
    // A preview has nothing to roll back — every handler already skips its
    // own writes via ctx.dryRun — so this reads through the plain singleton
    // rather than paying for a transaction that will never see a write.
    await runHandlers(prisma)
  } else {
    // The real tick: one transaction across every handler, so a failure
    // partway through (a thrown error, a violated constraint) leaves no
    // partial state instead of committing whatever ran before the failure.
    await prisma.$transaction(runHandlers, { timeout: tickTimeoutFor(factionCap, npcCap) })
  }

  // Dry run (World Sim Phase 8 debug tooling): every handler above already
  // skipped its own writes via ctx.dryRun, so the only thing left to skip
  // is this file's own persistence — nothing observed the DB in a way that
  // needs undoing, because nothing was ever written.
  if (dryRun) {
    return {
      campaignId,
      turnNumber,
      timestamp: new Date(),
      changes,
      historyEntriesCreated: 0,
      pendingAmbitions,
    }
  }

  // All three consumers fan out from the same changes array — the event-bus
  // shape, at the current scale, without a literal pub/sub mechanism.
  //
  // #236 (adversarial audit): this tick's own simulation-state transaction
  // has already committed by the time any of these three run — they are
  // documented (persistWorldEvents' own header comment) as best-effort,
  // non-critical history/memory/wiki bookkeeping, not something a failure
  // in one should be able to take the others (or the rest of this world
  // turn — advanceClocks, offscreen narration, chronicle generation, all
  // called from runWorldTurn right after this function returns) down
  // with. persistWorldEvents already caught its own failures internally;
  // logSignificantChanges and syncWikiEntriesForChanges are now hardened
  // the same way at their own call sites (see their file headers), but
  // this wraps all three independently anyway as the actual backstop for
  // the "best-effort" claim — an unexpected error in any one is logged
  // and does not prevent the next from running or propagate up to abort
  // the rest of the turn.
  let historyEntriesCreated = 0
  try {
    await persistWorldEvents(campaignId, turnNumber, changes)
  } catch (error) {
    console.error('⚠️ persistWorldEvents threw unexpectedly (non-critical, continuing):', error)
  }
  try {
    historyEntriesCreated = await logSignificantChanges(campaignId, turnNumber, changes)
  } catch (error) {
    console.error('⚠️ logSignificantChanges threw unexpectedly (non-critical, continuing):', error)
  }
  try {
    await syncWikiEntriesForChanges(campaignId, turnNumber, changes)
  } catch (error) {
    console.error('⚠️ syncWikiEntriesForChanges threw unexpectedly (non-critical, continuing):', error)
  }

  return {
    campaignId,
    turnNumber,
    timestamp: new Date(),
    changes,
    historyEntriesCreated,
    pendingAmbitions,
  }
}
