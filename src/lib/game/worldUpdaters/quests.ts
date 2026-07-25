// src/lib/game/worldUpdaters/quests.ts
// Domain applier for world_updates.quest_changes (former "7a": quest
// lifecycle — open/progress/close named undertakings from the fiction,
// matched by name like NPCs/factions). See README Known Bugs P1
// (stateUpdater decomposition, #4/#41).

import { Prisma } from '@prisma/client'
import type { WorldUpdates } from '@/lib/ai/schema'
import { applyQuestRewardGrant } from '../questRewards'
import { appendBounded, QUEST_PROGRESS_BOUNDS } from '../textAppend'
import { questObjectiveKey, resolveQuestGiver, questGiverUpdateData } from '../quests'
import { checkCorruptionGate, hasCorruptionGate } from '../corruptionGates'

type Db = Prisma.TransactionClient
export type QuestChange = NonNullable<WorldUpdates['quest_changes']>[number]

export async function applyQuestChanges(
  tx: Db,
  campaignId: string,
  currentTurnNumber: number,
  questChanges: QuestChange[]
): Promise<void> {
  console.log(`🎯 Applying ${questChanges.length} quest change(s)`)

  // Quest-giver rosters, fetched once per batch rather than per change —
  // the same discipline resolveEntityByNameOrId enforces for pc_changes.
  // Loaded lazily: most quest changes are progress updates that never name
  // a giver, and a batch of those shouldn't pay for two extra queries.
  let giverRosters: { npcs: Array<{ id: string; name: string }>; factions: Array<{ id: string; name: string }> } | null = null
  const getGiverRosters = async () => {
    if (!giverRosters) {
      const [npcs, factions] = await Promise.all([
        tx.nPC.findMany({ where: { campaignId }, select: { id: true, name: true } }),
        tx.faction.findMany({ where: { campaignId }, select: { id: true, name: true } }),
      ])
      giverRosters = { npcs, factions }
    }
    return giverRosters
  }

  // objectiveKey is unique per campaign, and these writes run inside the
  // scene-resolution transaction — a collision would abort the whole batch,
  // taking unrelated quest progress with it. Two differently-named quests
  // CAN slug the same ("The Ledger Job" / "The Ledger, Job!"), so the key is
  // only claimed when it's genuinely free. Losing a key costs a quest its
  // stable handle; throwing costs the turn.
  const claimObjectiveKey = async (questName: string, selfId?: string): Promise<string | null> => {
    const key = questObjectiveKey(questName)
    if (!key) return null
    const holder = await tx.quest.findFirst({
      where: { campaignId, objectiveKey: key },
      select: { id: true, name: true },
    })
    if (holder && holder.id !== selfId) {
      console.warn(`  ❓ quest "${questName}": key "${key}" already held by "${holder.name}" — left unkeyed`)
      return null
    }
    return key
  }

  // Corruption gate on ACQUISITION (#83). Evaluated against the party's
  // HIGHEST corruption, because that is what a quest-giver sees: one
  // deeply-marked member is enough for an order to turn the party away, and
  // enough for a forbidden patron to deal with them.
  //
  // Loaded lazily and once — most quest changes are progress updates on
  // quests already taken, which are never re-gated.
  let gateContext: { hasTheme: boolean; partyCorruption: number } | null = null
  const getGateContext = async () => {
    if (!gateContext) {
      const [campaign, characters] = await Promise.all([
        tx.campaign.findUnique({ where: { id: campaignId }, select: { corruptionTheme: true } }),
        tx.character.findMany({ where: { campaignId, isAlive: true }, select: { corruption: true } }),
      ])
      gateContext = {
        hasTheme: Boolean(campaign?.corruptionTheme),
        partyCorruption: characters.reduce((max, c) => Math.max(max, c.corruption || 0), 0),
      }
    }
    return gateContext
  }

  /**
   * May the party TAKE this quest? Only ever consulted on a transition
   * into ACTIVE — an already-active quest is never revoked and completion
   * is never blocked, because marks are irreversible and stranding a party
   * mid-job with no way back is exactly the trap a one-way track invites.
   *
   * Fails open on any error: refusing a quest the fiction just handed over
   * silently loses a thread, while permitting one costs a beat of flavor.
   */
  const questAcquisitionAllowed = async (quest: { minCorruption?: number | null; maxCorruption?: number | null }) => {
    if (!hasCorruptionGate(quest)) return true
    try {
      const ctx = await getGateContext()
      return checkCorruptionGate(quest, ctx.partyCorruption, ctx.hasTheme).allowed
    } catch (error) {
      console.error('Corruption quest gate check failed (allowing):', error)
      return true
    }
  }

  for (const questChange of questChanges) {
    if (!questChange?.name) continue
    const changes = questChange.changes || {}

    const existing = await tx.quest.findFirst({
      where: {
        campaignId,
        name: { equals: questChange.name, mode: 'insensitive' }
      }
    })

    const progressLine = changes.progress_append
      ? `Turn ${currentTurnNumber}: ${changes.progress_append}`
      : null

    if (existing) {
      const updateData: any = {}
      if (changes.description) updateData.description = changes.description
      if (changes.objective) updateData.objective = changes.objective
      if (changes.given_by) {
        updateData.givenBy = changes.given_by
        // Re-resolve on every reported giver: an NPC introduced after the
        // quest was registered can now be matched, so a quest that started
        // with an unresolvable giver gains a real one the moment the
        // fiction makes that possible.
        const rosters = await getGiverRosters()
        const link = resolveQuestGiver(changes.given_by, rosters.npcs, rosters.factions)
        Object.assign(updateData, questGiverUpdateData(link))
        if (link.kind === 'unresolved') {
          console.warn(`  ❓ quest "${existing.name}": giver "${changes.given_by}" matched no NPC or faction — kept as display text only`)
        }
      }
      // Backfill the stable handle for quests registered before it existed,
      // and re-key a quest the fiction has renamed.
      if (!existing.objectiveKey) {
        const key = await claimObjectiveKey(existing.name, existing.id)
        if (key) updateData.objectiveKey = key
      }
      if (changes.reward) updateData.reward = changes.reward
      if (changes.min_corruption !== undefined) updateData.minCorruption = changes.min_corruption
      if (changes.max_corruption !== undefined) updateData.maxCorruption = changes.max_corruption
      if (progressLine) {
        updateData.progressLog = appendBounded(existing.progressLog, progressLine, QUEST_PROGRESS_BOUNDS)
      }
      const justCompleted = changes.status === 'COMPLETED' && existing.status !== 'COMPLETED'
      if (changes.status && changes.status !== existing.status) {
        // Acquisition gate: only a transition INTO active is checked.
        const becomingActive = changes.status === 'ACTIVE' && existing.status !== 'ACTIVE'
        if (becomingActive && !(await questAcquisitionAllowed(existing))) {
          console.log(`  🌑 "${existing.name}" refused to this party — corruption gate`)
        } else {
          updateData.status = changes.status
          if (changes.status !== 'ACTIVE') updateData.resolvedAt = new Date()
        }
      }
      if (Object.keys(updateData).length > 0) {
        await tx.quest.update({ where: { id: existing.id }, data: updateData })
        console.log(`  🎯 Updated quest: ${existing.name}${changes.status ? ` (${changes.status})` : ''}`)
      }
      // Deterministic reward payout: only fires the first time this
      // quest transitions to COMPLETED, never on a repeated report of an
      // already-completed quest — see lib/game/questRewards.ts.
      if (justCompleted && changes.reward_grant) {
        // The quest's resolved giver faction funds the payout when the
        // grant doesn't name a payer — including a giver linked earlier in
        // this same batch, hence updateData over the stale row.
        const payerFactionId =
          (updateData.givenByFactionId as string | null | undefined) ?? existing.givenByFactionId
        const rewardLog = await applyQuestRewardGrant(
          tx, campaignId, existing.name, changes.reward_grant, payerFactionId, currentTurnNumber
        )
        for (const line of rewardLog) console.log(`  🎁 ${line}`)
      }
    } else {
      let giverData: { givenByNpcId: string | null; givenByFactionId: string | null } = {
        givenByNpcId: null,
        givenByFactionId: null,
      }
      if (changes.given_by) {
        const rosters = await getGiverRosters()
        const link = resolveQuestGiver(changes.given_by, rosters.npcs, rosters.factions)
        giverData = questGiverUpdateData(link)
        if (link.kind === 'unresolved') {
          console.warn(`  ❓ quest "${questChange.name}": giver "${changes.given_by}" matched no NPC or faction — kept as display text only`)
        }
      }
      await tx.quest.create({
        data: {
          campaignId,
          name: questChange.name,
          description: changes.description || questChange.name,
          objective: changes.objective || null,
          objectiveKey: await claimObjectiveKey(questChange.name),
          givenBy: changes.given_by || null,
          ...giverData,
          reward: changes.reward || null,
          minCorruption: changes.min_corruption ?? null,
          maxCorruption: changes.max_corruption ?? null,
          status: changes.status || 'ACTIVE',
          progressLog: progressLine,
          ...(changes.status && changes.status !== 'ACTIVE' ? { resolvedAt: new Date() } : {})
        }
      })
      console.log(`  🎯 Registered quest: ${questChange.name}`)
      // A quest can (rarely) be registered already-resolved in the same
      // turn it's introduced — same deterministic payout either way.
      if (changes.status === 'COMPLETED' && changes.reward_grant) {
        const rewardLog = await applyQuestRewardGrant(
          tx, campaignId, questChange.name, changes.reward_grant, giverData.givenByFactionId, currentTurnNumber
        )
        for (const line of rewardLog) console.log(`  🎁 ${line}`)
      }
    }
  }
}
