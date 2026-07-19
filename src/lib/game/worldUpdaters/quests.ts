// src/lib/game/worldUpdaters/quests.ts
// Domain applier for world_updates.quest_changes (former "7a": quest
// lifecycle — open/progress/close named undertakings from the fiction,
// matched by name like NPCs/factions). See README Known Bugs P1
// (stateUpdater decomposition, #4/#41).

import { Prisma } from '@prisma/client'
import type { WorldUpdates } from '@/lib/ai/schema'
import { applyQuestRewardGrant } from '../questRewards'

type Db = Prisma.TransactionClient
export type QuestChange = NonNullable<WorldUpdates['quest_changes']>[number]

export async function applyQuestChanges(
  tx: Db,
  campaignId: string,
  currentTurnNumber: number,
  questChanges: QuestChange[]
): Promise<void> {
  console.log(`🎯 Applying ${questChanges.length} quest change(s)`)

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
      if (changes.given_by) updateData.givenBy = changes.given_by
      if (changes.reward) updateData.reward = changes.reward
      if (progressLine) {
        updateData.progressLog = existing.progressLog
          ? `${existing.progressLog}\n${progressLine}`
          : progressLine
      }
      const justCompleted = changes.status === 'COMPLETED' && existing.status !== 'COMPLETED'
      if (changes.status && changes.status !== existing.status) {
        updateData.status = changes.status
        if (changes.status !== 'ACTIVE') updateData.resolvedAt = new Date()
      }
      if (Object.keys(updateData).length > 0) {
        await tx.quest.update({ where: { id: existing.id }, data: updateData })
        console.log(`  🎯 Updated quest: ${existing.name}${changes.status ? ` (${changes.status})` : ''}`)
      }
      // Deterministic reward payout: only fires the first time this
      // quest transitions to COMPLETED, never on a repeated report of an
      // already-completed quest — see lib/game/questRewards.ts.
      if (justCompleted && changes.reward_grant) {
        const rewardLog = await applyQuestRewardGrant(tx, campaignId, existing.name, changes.reward_grant)
        for (const line of rewardLog) console.log(`  🎁 ${line}`)
      }
    } else {
      await tx.quest.create({
        data: {
          campaignId,
          name: questChange.name,
          description: changes.description || questChange.name,
          objective: changes.objective || null,
          givenBy: changes.given_by || null,
          reward: changes.reward || null,
          status: changes.status || 'ACTIVE',
          progressLog: progressLine,
          ...(changes.status && changes.status !== 'ACTIVE' ? { resolvedAt: new Date() } : {})
        }
      })
      console.log(`  🎯 Registered quest: ${questChange.name}`)
      // A quest can (rarely) be registered already-resolved in the same
      // turn it's introduced — same deterministic payout either way.
      if (changes.status === 'COMPLETED' && changes.reward_grant) {
        const rewardLog = await applyQuestRewardGrant(tx, campaignId, questChange.name, changes.reward_grant)
        for (const line of rewardLog) console.log(`  🎁 ${line}`)
      }
    }
  }
}
