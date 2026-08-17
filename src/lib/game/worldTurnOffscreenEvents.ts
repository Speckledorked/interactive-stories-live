// src/lib/game/worldTurnOffscreenEvents.ts
// Generate offscreen events using AI — things happening in the background
// while nobody's watching. The one AI-calling step of the world turn;
// deliberately NOT in tick/, whose whole point is staying AI-free (see
// worldTick.ts's module doc). Called from worldTurn.ts's runWorldTurn.

import { prisma } from '@/lib/prisma'
import { callAIForWorldTurn } from '@/lib/ai/client'
import { buildWorldSummaryForAI } from '@/lib/ai/worldState'
import { applyWorldUpdates } from './stateUpdater'
import { createCampaignMemory, memoryDedupeKey } from '@/lib/ai/memoryCreation'
import { EventVisibility, FactionGoal } from '@prisma/client'
import { PendingAmbition } from './tick/types'
import { AMBITION_CATEGORY_OPTIONS } from './tick/ambitionTick'
import { sceneTurn, simTurn, type SimTurn } from './turnClock'

export async function generateOffscreenEvents(
  campaignId: string,
  // #437: the SIMULATION turn — this is one phase of a world turn.
  currentTurn: SimTurn,
  advancedClocks: any[],
  completedClocks: any[],
  completedGoalNpcs: Array<{ npcId: string; npcName: string; completedGoal: string | number }> = [],
  pendingAmbitions: PendingAmbition[] = [],
  inGameDayNumber?: number
) {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId }
    })

    if (!campaign) {
      throw new Error('Campaign not found')
    }

    // Build world summary
    const { worldSummary } = await buildWorldSummaryForAI(campaignId)

    // Recent ambition names (regardless of which faction spawned them) so the
    // AI doesn't repeat "Thornburg Guild Grand Tournament" for the third time
    // in a row — just enough context to vary itself, not a hard exclusion list.
    let recentAmbitionNames: string[] = []
    if (pendingAmbitions.length > 0) {
      const recentAmbitionClocks = await prisma.clock.findMany({
        where: { campaignId, sourceFactionId: { not: null } },
        select: { name: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })
      recentAmbitionNames = recentAmbitionClocks.map((c) => c.name)
    }

    // Call AI to generate offscreen events
    const aiResult = await callAIForWorldTurn(
      campaign.universe || 'Generic Fantasy',
      campaign.aiSystemPrompt,
      worldSummary,
      [...advancedClocks, ...completedClocks],
      campaignId,
      completedGoalNpcs,
      pendingAmbitions.map((a) => ({ factionId: a.factionId, factionName: a.factionName, goal: a.goal, archetype: a.archetype, targetFactionName: a.targetFactionName })),
      recentAmbitionNames
    )

    // Turn each pending ambition into a real Clock — the tick already decided
    // WHETHER; this resolves WHAT using the AI's pick if it gave one and is
    // actually one of the bounded options for that faction's archetype+goal,
    // otherwise the deterministic fallback so the ambition never silently
    // disappears. `category` on the Clock stays the MECHANICAL pacing value
    // from the tick (drives advanceClocks' tick speed) — the flavor
    // pick/fallback is narrative only and goes in gmNotes instead, so a
    // "black-market venture" flavor can never be mistaken for a pacing tag.
    for (const pending of pendingAmbitions) {
      const validOptions = AMBITION_CATEGORY_OPTIONS[pending.archetype as keyof typeof AMBITION_CATEGORY_OPTIONS]?.[pending.goal as 'ENRICH' | 'EXPAND' | 'DESTABILIZE_RIVAL'] || []
      const pick = aiResult.ambition_picks?.find((p) => p.faction_id === pending.factionId)
      const useAiPick = !!pick && validOptions.includes(pick.category)

      const name = useAiPick ? pick!.name : pending.fallbackName
      const description = useAiPick ? (pick!.description || pending.fallbackConsequence) : pending.fallbackConsequence
      const flavor = useAiPick ? pick!.category : pending.fallbackFlavor

      await prisma.clock.create({
        data: {
          campaignId,
          name,
          description,
          category: pending.category,
          maxTicks: pending.maxTicks,
          currentTicks: 0,
          consequence: pending.fallbackConsequence,
          gmNotes: pending.targetFactionName ? `Ambition type: ${flavor} (targeting ${pending.targetFactionName})` : `Ambition type: ${flavor}`,
          sourceFactionId: pending.factionId,
          targetFactionId: pending.targetFactionId,
          // #227: snapshot the goal this ambition is actually pursuing, so
          // a same-tick belief-drift change to Faction.goal later can't
          // change how this clock resolves — see Clock.goal's schema doc.
          // pending.goal is always sourced from a real Faction.goal value
          // (see tickFactionAmbitions in ambitionTick.ts) — this cast just
          // recovers the enum type PendingAmbition's plain-string field
          // (kept generic to avoid importing @prisma/client into tick/
          // types.ts) erased.
          goal: pending.goal as FactionGoal,
        },
      })

      console.log(`  🎯 ${pending.factionName} committed to: ${name} [${flavor}]${pending.targetFactionName ? ` targeting ${pending.targetFactionName}` : ''}${useAiPick ? '' : ' (fallback)'}`)
    }

    // Create timeline events for each offscreen event
    const createdEvents: { id: string; title: string; summary_gm: string }[] = []
    for (const event of aiResult.offscreen_events) {
      const created = await prisma.timelineEvent.create({
        data: {
          campaignId,
          turnNumber: currentTurn,
          title: event.title,
          summaryPublic: event.summary_public,
          summaryGM: event.summary_gm,
          isOffscreen: true,
          visibility: 'MIXED' as EventVisibility, // Players see public, GM sees full
          inGameDayNumber
        }
      })
      createdEvents.push({ id: created.id, title: event.title, summary_gm: event.summary_gm })

      console.log(`  📰 Created offscreen event: ${event.title}`)
    }

    // Apply any structured consequences (new/updated NPCs, faction changes,
    // and now locations) through the same path scene resolution uses, so a
    // named outcome (a tournament winner, a new rival, a villain's hideout)
    // becomes a real, queryable entity — not just a sentence in the event
    // summary above.
    let involvedNpcIds: string[] = []
    let involvedFactionIds: string[] = []
    const hasWorldUpdates =
      (aiResult.world_updates?.npc_changes?.length || 0) > 0 ||
      (aiResult.world_updates?.faction_changes?.length || 0) > 0 ||
      (aiResult.world_updates?.location_changes?.length || 0) > 0

    if (hasWorldUpdates) {
      // #437: applyWorldUpdates' third argument is the SCENE counter, and
      // this call passed it the simulation turn. Nothing read it on this
      // path — the offscreen payload is built literally above and carries
      // none of the scene-scoped change types — so the wrong unit was
      // inert, which is exactly the kind of dormant crossing that becomes a
      // real bug the day someone adds pc_changes or new_timeline_events to
      // the offscreen payload. One extra column on a read this function
      // already makes below buys the honest value.
      const sceneMeta = await prisma.worldMeta.findUnique({
        where: { campaignId },
        select: { currentTurnNumber: true },
      })
      const applied = await applyWorldUpdates(
        campaignId,
        {
          scene_text: '',
          world_updates: {
            npc_changes: aiResult.world_updates?.npc_changes,
            faction_changes: aiResult.world_updates?.faction_changes,
            location_changes: aiResult.world_updates?.location_changes,
          },
        },
        sceneTurn(sceneMeta?.currentTurnNumber ?? 0),
        // Fog of war: an offscreen event happening in the background is not
        // the party witnessing anything — it must not reveal entities.
        false,
        inGameDayNumber
      )
      involvedNpcIds = applied.involvedNpcIds
      involvedFactionIds = applied.involvedFactionIds
      console.log(`  🌍 Applied offscreen world updates: ${involvedNpcIds.length} NPC(s), ${involvedFactionIds.length} faction(s) touched`)
    }

    // Embed each offscreen event into campaign memory so it's retrievable
    // by semantic search indefinitely, not just while it's within the last
    // ~10-20 timeline events the prompt builder includes directly. This is
    // what lets a player ask "who won the tournament?" turns later and get
    // the real answer instead of the AI improvising a fresh one.
    for (const event of createdEvents) {
      await createCampaignMemory({
        campaignId,
        memoryType: 'WORLD_EVENT',
        sourceId: event.id,
        turnNumber: currentTurn,
        // #377: a replayed world turn must not re-buy this embedding.
        // event.id is a real persisted row id, so it is stable across the
        // replay in a way the AI-authored title isn't.
        dedupeKey: memoryDedupeKey({
          memoryType: 'WORLD_EVENT',
          sourceId: event.id,
          turnNumber: currentTurn,
          title: event.title,
        }),
        title: event.title,
        summary: event.summary_gm,
        fullContext: event.summary_gm,
        involvedCharacterIds: [],
        involvedNpcIds,
        involvedFactionIds,
        locationTags: [],
        importance: 'NORMAL',
        tags: ['offscreen_event', 'world_turn'],
      }).catch(err => console.error(`  ⚠️ Failed to embed memory for offscreen event "${event.title}":`, err))
    }

    // Store GM notes
    if (aiResult.gm_notes) {
      const worldMeta = await prisma.worldMeta.findUnique({
        where: { campaignId }
      })

      if (worldMeta) {
        const currentMeta = worldMeta.otherMeta as any || {}
        const worldTurnNotes = currentMeta.world_turn_notes || []

        worldTurnNotes.push({
          turn: currentTurn,
          notes: aiResult.gm_notes,
          timestamp: new Date().toISOString()
        })

        // Keep only last 10 turns
        if (worldTurnNotes.length > 10) {
          worldTurnNotes.shift()
        }

        await prisma.worldMeta.update({
          where: { id: worldMeta.id },
          data: {
            otherMeta: {
              ...currentMeta,
              world_turn_notes: worldTurnNotes
            }
          }
        })
      }
    }

    console.log(`  ✅ Generated ${aiResult.offscreen_events.length} offscreen event(s)`)
  } catch (error) {
    console.error('  ⚠️ Failed to generate offscreen events:', error)
    // Don't throw - world turn can continue without AI-generated events
  }
}
