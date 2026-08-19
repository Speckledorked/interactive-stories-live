// src/lib/game/stateUpdater.ts
// Apply AI GM world updates to the database.
// This is where the AI's narrative decisions become persistent game state.
//
// This file is the orchestrator only: it fetches the shared per-batch
// entity rosters once (see entityResolution.ts) and calls one domain
// applier per world_updates field, in the same order the original
// monolithic implementation did. Each domain applier lives in
// ./worldUpdaters/ and is independently unit-tested — see #4/#41
// (stateUpdater decomposition) for why this file used to
// be ~1,400 lines with no direct test coverage.

import { Clock } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AIGMResponse } from '@/lib/ai/client'
import type { ActionMechanics } from './resolution'
import { parseCorruptionTheme, CorruptionTheme } from './corruption'

import { applyTimelineEventChanges } from './worldUpdaters/timelineEvents'
import { applyClockChanges } from './worldUpdaters/clocks'
import { applyNpcChanges } from './worldUpdaters/npcs'
import { applyCharacterChanges } from './worldUpdaters/characters'
import { applyFactionChanges } from './worldUpdaters/factions'
import { applyLocationChanges } from './worldUpdaters/locations'
import { applyQuestChanges } from './worldUpdaters/quests'
import { applyBargainOffers } from './worldUpdaters/bargainOffers'
import { storeGmNotesForTurn } from './worldUpdaters/worldMetaNotes'
import { currentSimulationTurn } from './tick/simulationClock'
import { simTurn, type SimTurn, type SceneTurn } from './turnClock'
import { persistWorldEvents } from './tick/worldEventLog'
import type { WorldChange } from './tick/types'

// Re-exported so existing importers (sceneResolver.ts) don't need to
// change — the implementation lives in stubEnrichment.ts now, see there
// for why the two were merged.
export { enrichStubNPCs, enrichStubFactions } from './stubEnrichment'

/**
 * Apply all world updates from an AI GM response to the database
 * This is transactional - if any update fails, all are rolled back
 *
 * @param campaignId - Campaign to update
 * @param aiResponse - AI GM's response with world_updates
 * @param currentTurnNumber - The turn number being resolved
 */
export interface AppliedWorldUpdates {
  /** NPC IDs actually resolved/created while applying npc_changes — the scene's real entity linkage. */
  involvedNpcIds: string[]
  /** Faction IDs actually resolved/created while applying faction_changes. */
  involvedFactionIds: string[]
  /** character_name_or_id values from pc_changes that never matched a real character — that whole entry was dropped. */
  unresolvedCharacterNames: string[]
  /** #175: every WorldChange this scene resolution produced, already persisted to WorldEvent by the time this resolves. */
  worldChanges: WorldChange[]
  /**
   * Rules refusals: things the narration described that state did not
   * honour — an unaffordable purchase, a corruption gate turning someone
   * away. Carried out rather than only logged, because a refusal the player
   * never sees is indistinguishable from the purchase having happened.
   */
  gateRefusals: string[]
}

export async function applyWorldUpdates(
  campaignId: string,
  aiResponse: AIGMResponse,
  // #437: the SCENE counter (WorldMeta.currentTurnNumber). Reaches only the
  // per-character/quest/bargain JSON blobs below, all of which are scene-
  // scoped by nature and compared against this same counter on read. The
  // two SHARED-HISTORY writes this function makes — TimelineEvent and
  // EventWitness — are stamped on the simulation clock instead, via
  // simulationTurn() below; see turnClock.ts for why every persisted turn
  // column is on that clock.
  currentTurnNumber: SceneTurn,
  // Fog of war: true when this call is resolving a scene the players are
  // actually in — the party witnessing an NPC/faction is what reveals them,
  // so isDiscovered only flips to true on this path. Offscreen background
  // events (see worldTurn.ts) pass false: the simulation moving a faction
  // the party has never met must not silently teach the AI to talk about
  // it as if they had.
  sceneOrigin: boolean = true,
  // The in-game day these AI-named timeline events happened on — see
  // calendar.ts. Optional only because a caller that predates the
  // calendar migration has nothing sensible to pass; such rows just keep
  // inGameDayNumber null.
  inGameDayNumber?: number,
  // The engine's own pre-rolled per-character outcome for this exchange
  // (resolution.ts), threaded through to applyCharacterChanges for
  // Character.stress drift (see stress.ts). Defaults empty for callers
  // with nothing to report — offscreen world-turn narration never touches
  // pc_changes at all, so this is simply unused on that path.
  actionMechanics: ActionMechanics[] = [],
  // #101: characters actually present in this scene — every SIGNIFICANT
  // WorldEvent this call produces gets a WITNESSED EventWitness row for
  // each of them. Empty by default (and effectively ignored whenever
  // sceneOrigin is false, see below) so every caller that predates this
  // parameter, and the offscreen path in particular, correctly witnesses
  // nobody — matching sceneOrigin's own "must not silently teach the AI"
  // comment above, now extended from entity discovery to event knowledge.
  witnessCharacterIds: string[] = []
): Promise<AppliedWorldUpdates> {
  console.log('💾 Applying world updates to database...')

  const { world_updates } = aiResponse

  let involvedNpcIds: string[] = []
  let involvedFactionIds: string[] = []
  let unresolvedCharacterNames: string[] = []
  // Rules refusals the fiction described but state did not honour — an
  // unaffordable purchase, a corruption gate turning someone away.
  const gateRefusals: string[] = []
  // #175: collected across every domain applier below, persisted to
  // WorldEvent once the transaction commits (see persistWorldEvents' own
  // doc comment — best-effort, outside the transaction, same as every
  // other call site of this function).
  const worldChanges: WorldChange[] = []

  // #437: read at most once per call, and only when something shared-history
  // actually needs it — a scene with no timeline events and no significant
  // changes still must not pay for an extra WorldMeta round-trip.
  let simulationTurnMemo: SimTurn | undefined
  const simulationTurn = async (): Promise<SimTurn> => {
    if (simulationTurnMemo === undefined) {
      simulationTurnMemo = simTurn(await currentSimulationTurn(campaignId))
    }
    return simulationTurnMemo
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Lazily fetched the first time a corruption_change or bargain_offer
      // appears, and shared between the two — undefined means "not looked
      // up yet", null means "this campaign has no theme".
      let corruptionTheme: CorruptionTheme | null | undefined = undefined
      const getCorruptionTheme = async (): Promise<CorruptionTheme | null> => {
        if (corruptionTheme === undefined) {
          const campaignRow = await tx.campaign.findUnique({
            where: { id: campaignId },
            select: { corruptionTheme: true }
          })
          corruptionTheme = parseCorruptionTheme(campaignRow?.corruptionTheme)
        }
        return corruptionTheme
      }

      // 1. Create timeline events
      if (world_updates.new_timeline_events) {
        // #437: TimelineEvent.turnNumber is a sim-clock column. It used to
        // take whatever this function was called with, so a scene-resolved
        // event was stamped on the scene counter and an offscreen one on the
        // sim counter — then the prompt's "last 10 events" ordered the two
        // together, across incomparable units, letting one source crowd the
        // other out entirely.
        await applyTimelineEventChanges(tx, campaignId, await simulationTurn(), world_updates.new_timeline_events, inGameDayNumber)
      }

      // Fetched once per batch and resolved against in-memory (exact -> a
      // single confident fuzzy match) rather than a per-item `contains`
      // query — see entityResolution.ts. `contains` could both cross-match
      // an unrelated entity whose name merely contained the search string,
      // and fail on a trivial AI-side typo, silently auto-creating a
      // duplicate stub instead of updating the real one. See the Fix Log in docs/ARCHITECTURE.md.
      const clocksForResolution = world_updates.clock_changes?.length
        ? await tx.clock.findMany({ where: { campaignId } })
        : []
      // pc_changes needs this roster too: relationship_changes name an NPC,
      // and resolving them requires the same roster npc_changes uses.
      const npcsForResolution = (world_updates.npc_changes?.length || world_updates.pc_changes?.length)
        ? await tx.nPC.findMany({ where: { campaignId } })
        : []
      const charactersForResolution = (world_updates.npc_changes?.length || world_updates.pc_changes?.length)
        ? await tx.character.findMany({ where: { campaignId } })
        : []
      const factionsForResolution = world_updates.faction_changes?.length
        ? await tx.faction.findMany({ where: { campaignId } })
        : []

      // 2. Update clocks
      if (world_updates.clock_changes) {
        const result = await applyClockChanges(tx, world_updates.clock_changes, clocksForResolution)
        worldChanges.push(...result.worldChanges)
      }

      // 3. Update NPCs
      if (world_updates.npc_changes) {
        const result = await applyNpcChanges(
          tx, campaignId, world_updates.npc_changes, npcsForResolution, charactersForResolution, sceneOrigin
        )
        involvedNpcIds = result.involvedNpcIds
        worldChanges.push(...result.worldChanges)
      }

      // 4. Update player characters
      if (world_updates.pc_changes) {
        const result = await applyCharacterChanges(
          tx, campaignId, currentTurnNumber, world_updates.pc_changes, charactersForResolution, npcsForResolution, getCorruptionTheme, sceneOrigin, actionMechanics
        )
        // Corruption gates (#83) refusing a move is a real world event, not
        // a silent no-op — a character the narrator described walking into
        // a shrine did not actually go in, and the log is where that
        // divergence between prose and state is visible.
        for (const refusal of result.gateRefusals) {
          console.log(`  🌑 ${refusal}`)
        }
        // Carried out, not just logged. A refusal the server prints and the
        // player never sees is the same "something silently didn't happen"
        // shape the dice-mechanics banner exists for.
        gateRefusals.push(...result.gateRefusals)
        unresolvedCharacterNames = result.unresolvedCharacterNames
        worldChanges.push(...result.worldChanges)
      }

      // organic_advancement (stat_increases/new_perks/new_moves) is deliberately
      // NOT processed here — applyOrganicCharacterGrowth in sceneResolver.ts is
      // the single writer for it (merges this with system-computed growth,
      // validates PbtA stat constraints, dedupes perks/moves by id). Processing
      // it here too would double-apply every stat increase, perk, and move the
      // AI reports, since both run in the same resolution.

      // 6. Update factions
      if (world_updates.faction_changes) {
        const result = await applyFactionChanges(
          tx, campaignId, world_updates.faction_changes, factionsForResolution, sceneOrigin
        )
        involvedFactionIds = result.involvedFactionIds
        worldChanges.push(...result.worldChanges)
      }

      // 7. Upsert locations
      if (world_updates.location_changes) {
        const result = await applyLocationChanges(tx, campaignId, world_updates.location_changes, sceneOrigin)
        worldChanges.push(...result.worldChanges)
      }

      // 7a. Quest lifecycle: open/progress/close named undertakings from
      // the fiction. Matched by name (case-insensitive) like NPCs/factions.
      if (world_updates.quest_changes) {
        const result = await applyQuestChanges(tx, campaignId, currentTurnNumber, world_updates.quest_changes)
        worldChanges.push(...result.worldChanges)
      }

      // 7a-bis. Corruption bargain offers: persist so the character's NEXT
      // action can mechanically invoke them (see resolution.ts surge).
      // Live scenes only — an offscreen tick can't put an offer in front
      // of a player — and only in campaigns that actually have a theme.
      if (sceneOrigin && world_updates.bargain_offers && world_updates.bargain_offers.length > 0) {
        await applyBargainOffers(tx, campaignId, currentTurnNumber, world_updates.bargain_offers, getCorruptionTheme)
      }

      // 8. Store GM notes in WorldMeta if provided
      if (world_updates.notes_for_gm) {
        await storeGmNotesForTurn(tx, campaignId, currentTurnNumber, world_updates.notes_for_gm)
      }
    })

    console.log('✅ All world updates applied successfully')

    // #175: best-effort, outside the transaction — same placement
    // worldTick.ts/consequences.ts already use for this exact call. A
    // failure here must not undo (or block) the world updates that just
    // committed; persistWorldEvents' own doc comment covers the tradeoff.
    if (worldChanges.length > 0) {
      // #374: stamped on the SIMULATION clock, not currentTurnNumber (the
      // scene counter this function is called with). WorldEvent.turnNumber
      // is read as elapsed simulation time by informationTick's age
      // arithmetic and by the per-turn event windows in beliefTick /
      // npcDispositionTick; mixing the two counters into one column makes
      // every window over it meaningless. Several scenes resolving between
      // two world turns legitimately share one simulation turn.
      const eventTurn = await simulationTurn()
      const { events } = await persistWorldEvents(campaignId, eventTurn, worldChanges)

      // #101: everyone present in this scene WITNESSED whatever significant
      // things just happened in it — this is the scene's whole party, not
      // narrowed to exactly who caused/was targeted by any one change (the
      // same scene-level, not exchange-level, granularity fog-of-war
      // discovery already operates at above). Gated on sceneOrigin, same as
      // discovery: the offscreen background-tick path must not silently
      // teach a character about something they were never there for.
      if (sceneOrigin && witnessCharacterIds.length > 0) {
        const significantEventIds = events.filter((e) => e.significant).map((e) => e.id)
        if (significantEventIds.length > 0) {
          try {
            await prisma.eventWitness.createMany({
              data: significantEventIds.flatMap((worldEventId) =>
                witnessCharacterIds.map((characterId) => ({
                  campaignId,
                  worldEventId,
                  characterId,
                  grade: 'WITNESSED' as const,
                  // #437: the SIMULATION turn, same as the WorldEvent this
                  // row witnesses — resolved by the memo above, for exactly
                  // the reason the #374 comment there gives. This stamped
                  // currentTurnNumber, so EventWitness.turnNumber had two
                  // writers on two clocks (informationTick writes the sim
                  // turn) and the recency window in worldSummary compared
                  // the mixture against a third.
                  turnNumber: eventTurn,
                }))
              ),
              skipDuplicates: true,
            })
          } catch (error) {
            console.error('⚠️ Failed to persist event witnesses (non-critical):', error)
          }
        }
      }
    }

    return { involvedNpcIds, involvedFactionIds, unresolvedCharacterNames, worldChanges, gateRefusals }
  } catch (error) {
    console.error('❌ Failed to apply world updates:', error)
    throw new Error(`Failed to apply world updates: ${error}`)
  }
}

/**
 * Check for completed clocks and create consequence events
 * Called during world turns
 *
 * @param campaignId - Campaign to check
 * @returns Array of completed clocks
 */
export async function checkAndResolveCompletedClocks(
  campaignId: string,
  // #437: the SIMULATION turn. Only ever called from runWorldTurn, which
  // works in world turns — the parameter was named after the scene counter
  // and the TimelineEvent rows it writes are sim-clock, so the name was the
  // only thing wrong here. Branded so it stays that way.
  simulationTurn: SimTurn,
  inGameDayNumber?: number
): Promise<Clock[]> {
  console.log('🔍 Checking for completed clocks...')

  const completedClocks = await prisma.clock.findMany({
    where: {
      campaignId,
      currentTicks: { gte: prisma.clock.fields.maxTicks },
      resolvedAt: null
    }
  })

  if (completedClocks.length === 0) {
    console.log('  No completed clocks')
    return []
  }

  console.log(`⏰ ${completedClocks.length} clock(s) completed!`)

  // Create timeline events for each completed clock
  for (const clock of completedClocks) {
    // Ambition-sourced clocks (see ambitionTick.ts) get their real
    // success/failure outcome narrated by worldTurn.ts's
    // resolveCompletedAmbitions instead of this generic flavor-text event —
    // it knows whether the ambition actually succeeded, this doesn't.
    if (!clock.sourceFactionId) {
      await prisma.timelineEvent.create({
        data: {
          campaignId,
          turnNumber: simulationTurn,
          title: `${clock.name} - Complete!`,
          summaryPublic: clock.consequence,
          summaryGM: `Clock "${clock.name}" reached ${clock.maxTicks} ticks. ${clock.gmNotes}`,
          isOffscreen: true,
          visibility: clock.isHidden ? 'GM_ONLY' : 'PUBLIC',
          inGameDayNumber
        }
      })

      console.log(`  ⏰ Created event for: ${clock.name}`)
    }

    await prisma.clock.update({
      where: { id: clock.id },
      data: { resolvedAt: new Date() }
    })
  }

  return completedClocks
}

/**
 * Simple helper to log what changed
 * Useful for debugging and admin views
 */
export function summarizeWorldUpdates(aiResponse: AIGMResponse): string {
  const updates = aiResponse.world_updates
  const summary: string[] = []

  if (updates.new_timeline_events?.length) {
    summary.push(`${updates.new_timeline_events.length} new timeline events`)
  }

  if (updates.clock_changes?.length) {
    summary.push(`${updates.clock_changes.length} clock changes`)
  }

  if (updates.npc_changes?.length) {
    summary.push(`${updates.npc_changes.length} NPC updates`)
  }

  if (updates.pc_changes?.length) {
    summary.push(`${updates.pc_changes.length} character updates`)
  }

  if (updates.faction_changes?.length) {
    summary.push(`${updates.faction_changes.length} faction updates`)
  }

  if (updates.notes_for_gm) {
    summary.push('GM notes recorded')
  }

  return summary.length > 0
    ? summary.join(', ')
    : 'No world changes'
}

