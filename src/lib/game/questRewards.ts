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
// exactly what's reported (never guessing at amounts from prose), clamped
// to a sane magnitude the same way every other reported number in this
// engine is (see economy.ts's clampGoldDelta).

import { Prisma } from '@prisma/client'
import { applyStandingChanges, StandingChange } from './standing'
import { clampGoldDelta } from './economy'
import { assessPayout, describeDefault } from './factionPayout'

type Db = Prisma.TransactionClient

export interface RewardGrantItem {
  id: string
  name: string
  quantity: number
  tags?: string[]
  armorValue?: number
  itemType?: 'weapon' | 'armor' | 'consumable' | 'quest' | 'currency' | 'misc'
  damageBonus?: number
  effect?: { kind: 'heal' | 'custom'; amount?: number; description: string }
}

export interface RewardGrant {
  character_names?: string[]
  gold?: number
  items?: RewardGrantItem[]
  standing_changes?: StandingChange[]
  /** Faction footing the bill — see resolvePayingFaction below. */
  paid_by_faction?: string
}

interface InventoryForMerge {
  items?: Array<{
    id: string; name: string; quantity: number; tags?: string[]
    armorValue?: number
    itemType?: 'weapon' | 'armor' | 'consumable' | 'quest' | 'currency' | 'misc'
    damageBonus?: number
    effect?: { kind: 'heal' | 'custom'; amount?: number; description: string }
  }>
}

/**
 * Pure: merge granted items into an existing inventory blob — same
 * accumulate-by-id semantics as inventory_changes.items_add in
 * stateUpdater.ts. No DB access, so it's testable directly.
 */
export function mergeGrantedItems(
  currentInventory: InventoryForMerge | null | undefined,
  granted: RewardGrantItem[] | undefined
): { items: Array<NonNullable<InventoryForMerge['items']>[number] & { tags: string[] }> } {
  const items = (currentInventory?.items || []).map(i => ({ ...i, tags: i.tags || [] }))
  for (const item of granted || []) {
    const existing = items.find(i => i.id === item.id)
    if (existing) {
      existing.quantity += item.quantity
    } else {
      items.push({ ...item, tags: item.tags || [] })
    }
  }
  return { items }
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
  grant: RewardGrant,
  // The quest's resolved giver faction (#75), used as the payer when the
  // grant doesn't name one. A resolved FK is a fact, not a guess, which is
  // why it's an acceptable fallback where inferring a payer from adjacent
  // fields would not be.
  giverFactionId?: string | null
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

  // A reward is always a payout, never a debit — floor at 0 on top of the
  // shared magnitude clamp (see economy.ts).
  const promisedEach = Math.max(0, clampGoldDelta(grant.gold))

  // Faction-funded payouts are TRANSFERS: what the faction pays, it stops
  // having, and a faction that can't afford its promise defaults on part
  // of it. A payout with no identifiable faction payer behaves exactly as
  // it always did — paid in full, from nowhere.
  let goldEach = promisedEach
  if (hasGold && promisedEach > 0) {
    const payer = await resolvePayingFaction(db, campaignId, grant.paid_by_faction, giverFactionId)
    if (payer) {
      // Assessed as a TOTAL across recipients: a five-person party each
      // paid 200 costs the faction a thousand, not two hundred.
      const assessment = assessPayout(promisedEach * recipients.length, payer.resources)
      goldEach = Math.floor(assessment.paid / recipients.length)

      if (assessment.resourceCost > 0) {
        await db.faction.update({
          where: { id: payer.id },
          data: { resources: Math.max(0, payer.resources - assessment.resourceCost) },
        })
      }
      if (assessment.defaulted) {
        log.push(describeDefault(payer.name, assessment))
      }
    }
  }

  for (const recipient of recipients) {
    const updateData: Record<string, unknown> = {}

    if (hasGold && goldEach > 0) {
      const resources = (recipient.resources as any) || { gold: 0, contacts: [], reputation: {} }
      resources.gold = Math.max(0, (resources.gold || 0) + goldEach)
      updateData.resources = resources
      log.push(`${recipient.name} received ${goldEach} gold from completing "${questName}"`)
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

interface PayingFaction {
  id: string
  name: string
  resources: number
}

/**
 * Who is actually paying, if anyone.
 *
 * Order: the grant's explicit `paid_by_faction`, then the quest's resolved
 * giver faction. Nothing else — in particular NOT `standing_changes`, even
 * though a reward that shifts standing with a faction is usually paid by
 * that faction. "Usually" is the problem: deducing a payer from an adjacent
 * field is the guesswork this engine avoids everywhere else, and being
 * wrong here drains an institution that was never involved and cascades
 * into war outcomes and ambition thresholds.
 *
 * A named faction that doesn't resolve returns null, so the payout falls
 * back to the old free-money behavior rather than being silently withheld.
 * Failing to charge someone is a much cheaper error than failing to pay
 * the party what the fiction promised them.
 */
async function resolvePayingFaction(
  db: Db,
  campaignId: string,
  namedFaction: string | undefined,
  giverFactionId: string | null | undefined
): Promise<PayingFaction | null> {
  const name = namedFaction?.trim()
  if (name) {
    const byName = await db.faction.findFirst({
      where: { campaignId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true, resources: true },
    })
    if (byName) return byName
    console.warn(`  ❓ reward_grant paid_by_faction "${name}" matched no faction — paid without a payer`)
    return null
  }

  if (giverFactionId) {
    return db.faction.findUnique({
      where: { id: giverFactionId },
      select: { id: true, name: true, resources: true },
    })
  }

  return null
}
