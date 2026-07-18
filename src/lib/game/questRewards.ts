// src/lib/game/questRewards.ts
// Deterministic quest-completion payout (depth-hardening #31 — see README).
//
// Quest.reward is free-form flavor text the AI can phrase however it likes
// ("200 gold and guild favor") — nothing ever enforced it actually being
// granted; a quest closing depended entirely on the AI separately
// remembering to also emit a matching pc_changes entry the same turn.
// reward_grant is the structured payload this module actually applies when
// a quest's status becomes COMPLETED, the same discipline pc_changes'
// resource/inventory/standing changes already use — the code applies
// exactly what's reported, it never guesses at amounts from prose.

import { Prisma } from '@prisma/client'
import { applyStandingChanges, StandingChange } from './standing'

type Db = Prisma.TransactionClient

export interface RewardGrantItem {
  id: string
  name: string
  quantity: number
  tags?: string[]
}

export interface RewardGrant {
  character_names?: string[]
  gold?: number
  items?: RewardGrantItem[]
  standing_changes?: StandingChange[]
}

interface InventoryForMerge {
  items?: Array<{ id: string; name: string; quantity: number; tags?: string[] }>
  slots?: number
}

/**
 * Pure: merge granted items into an existing inventory blob — same
 * accumulate-by-id semantics as inventory_changes.items_add in
 * stateUpdater.ts. No DB access, so it's testable directly.
 */
export function mergeGrantedItems(
  currentInventory: InventoryForMerge | null | undefined,
  granted: RewardGrantItem[] | undefined
): { items: Array<{ id: string; name: string; quantity: number; tags: string[] }>; slots: number } {
  const items = (currentInventory?.items || []).map(i => ({ ...i, tags: i.tags || [] }))
  for (const item of granted || []) {
    const existing = items.find(i => i.id === item.id)
    if (existing) {
      existing.quantity += item.quantity
    } else {
      items.push({ ...item, tags: item.tags || [] })
    }
  }
  return { items, slots: currentInventory?.slots ?? 10 }
}

interface RecipientCharacter {
  id: string
  name: string
  resources: any
  inventory: any
}

/**
 * Apply a completed quest's reward_grant to its recipients — named
 * characters if given, otherwise every living party member. Gold and items
 * are written directly; standing_changes reuse the exact same writer
 * pc_changes' standing_changes uses (applyStandingChanges), so a quest
 * reward and an in-scene favor move standing through identical, already-
 * tested logic rather than a parallel implementation. Returns human-
 * readable log lines for the resolution summary.
 */
export async function applyQuestRewardGrant(
  db: Db,
  campaignId: string,
  questName: string,
  grant: RewardGrant
): Promise<string[]> {
  const log: string[] = []
  const hasGold = (grant.gold ?? 0) !== 0
  const hasItems = (grant.items?.length ?? 0) > 0
  const hasStanding = (grant.standing_changes?.length ?? 0) > 0
  if (!hasGold && !hasItems && !hasStanding) return log

  const names = (grant.character_names || []).map(n => n.trim()).filter(Boolean)

  let recipients: RecipientCharacter[]
  if (names.length > 0) {
    const matches = await Promise.all(
      names.map(name =>
        db.character.findFirst({
          where: { campaignId, isAlive: true, name: { contains: name, mode: 'insensitive' } },
          select: { id: true, name: true, resources: true, inventory: true },
        })
      )
    )
    recipients = matches.filter((r): r is RecipientCharacter => r !== null)
  } else {
    recipients = await db.character.findMany({
      where: { campaignId, isAlive: true },
      select: { id: true, name: true, resources: true, inventory: true },
    })
  }

  if (recipients.length === 0) {
    console.warn(`  ❓ reward_grant for "${questName}": no matching recipient(s) — skipped`)
    return log
  }

  for (const recipient of recipients) {
    const updateData: Record<string, unknown> = {}

    if (hasGold) {
      const resources = (recipient.resources as any) || { gold: 0, contacts: [], reputation: {} }
      resources.gold = Math.max(0, (resources.gold || 0) + (grant.gold || 0))
      updateData.resources = resources
      log.push(`${recipient.name} received ${grant.gold} gold from completing "${questName}"`)
    }

    if (hasItems) {
      updateData.inventory = mergeGrantedItems(recipient.inventory as any, grant.items)
      const itemNames = (grant.items || []).map(i => `${i.quantity}x ${i.name}`).join(', ')
      log.push(`${recipient.name} received ${itemNames} from completing "${questName}"`)
    }

    if (Object.keys(updateData).length > 0) {
      await db.character.update({ where: { id: recipient.id }, data: updateData })
    }

    if (hasStanding) {
      await applyStandingChanges(db, campaignId, recipient.id, recipient.name, grant.standing_changes!, log)
    }
  }

  return log
}
