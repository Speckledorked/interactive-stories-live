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
import { inventoryValue, applyGrantBudget } from './itemValue'

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
  /** Worth and scarcity — both mechanically read, see lib/game/itemValue.ts. */
  value?: number
  rarity?: 'common' | 'uncommon' | 'rare' | 'legendary'
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
  giverFactionId?: string | null,
  // Current turn, for the per-arc rarity budget. Omitted means unbudgeted,
  // which is the right degradation for a caller with no turn context —
  // refusing rewards against a turn number we had to invent would be worse
  // than not budgeting.
  currentTurn?: number | null
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
  // Items cost the payer too. Before value existed, an items-only reward
  // was FREE to the faction handing it over, so a bankrupt patron could
  // settle every debt in artifacts forever — a real hole in the transfer
  // model, and the reason `value` had to be more than a display field.
  const itemsCost = inventoryValue(grant.items) * recipients.length

  let goldEach = promisedEach
  if ((hasGold && promisedEach > 0) || itemsCost > 0) {
    const payer = await resolvePayingFaction(db, campaignId, grant.paid_by_faction, giverFactionId)
    if (payer) {
      // Assessed as a TOTAL across recipients: a five-person party each
      // paid 200 costs the faction a thousand, not two hundred.
      //
      // Gold and goods are assessed together against one budget, because
      // they come out of the same coffers. Only the GOLD half can be
      // reduced by a shortfall, though: goods the fiction already handed
      // over cannot be un-given, so a faction that overreaches pays for it
      // in resources rather than by clawing an item back out of a
      // character's pack.
      const assessment = assessPayout(promisedEach * recipients.length + itemsCost, payer.resources)
      const paidTowardGold = Math.max(0, assessment.paid - itemsCost)
      goldEach = recipients.length > 0 ? Math.floor(paidTowardGold / recipients.length) : 0

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
      // Per-arc rarity budget (#44/#47), applied per recipient because the
      // budget is a property of a character's own haul, not of the party's.
      let toGrant = grant.items || []
      if (typeof currentTurn === 'number') {
        const existing = ((recipient.inventory as any)?.items || []) as Array<{ rarity?: string | null; grantedTurn?: number | null }>
        const budget = applyGrantBudget(existing, toGrant, currentTurn)
        for (const skippedItem of budget.skipped) {
          log.push(`${skippedItem.name} was promised but is beyond what ${recipient.name} has earned this arc`)
        }
        toGrant = budget.granted.map(item => ({ ...item, grantedTurn: currentTurn })) as typeof toGrant
      }

      if (toGrant.length > 0) {
        updateData.inventory = mergeGrantedItems(recipient.inventory as any, toGrant)
        const itemNames = toGrant.map(i => `${i.quantity}x ${i.name}`).join(', ')
        log.push(`${recipient.name} received ${itemNames} from completing "${questName}"`)
      }
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
