// src/lib/downtime/downtimeRewards.ts
//
// Apply what a completed downtime activity actually earned (#74).
//
// generateDynamicOutcomes asks the AI for a structured completion payload —
// gold, items created, contacts made, faction reputation shifts — then
// stored it verbatim on DowntimeActivity.outcomes and applied none of it.
// The code said so outright: "Character experience/gold rewards removed as
// Character model doesn't have these fields." That was true of an older
// schema and isn't any more (Character.resources carries gold and contacts;
// FactionStanding is a real table), so the note had quietly become a
// standing excuse for a dead pipe. A player could finish a week of downtime
// narrated as "+2 with the Thieves' Guild and 300 gold" and have nothing at
// all change on their sheet.
//
// Costs on the way IN were always enforced (chargeDowntimeCosts), which is
// the asymmetry that makes this worth fixing rather than deleting: the
// engine took the entry fee and then didn't pay out.
//
// Parsing is deliberately strict and lossy-in-one-direction: anything that
// doesn't cleanly match the documented shape is SKIPPED and logged, never
// guessed at. The AI writes these as loose prose-ish strings, and inventing
// a number from an unparseable one would be exactly the "trust the model's
// arithmetic" pattern the rest of this engine exists to avoid.

import { Prisma } from '@prisma/client'
import { applyStandingChanges, StandingChange } from '@/lib/game/standing'
import { clampGoldDelta } from '@/lib/game/economy'
import { mergeGrantedItems, RewardGrantItem } from '@/lib/game/questRewards'
import { applyGrantBudget } from '@/lib/game/itemValue'
import { slugifyCapabilityKey } from '@/lib/game/capabilities'

type Db = Prisma.TransactionClient

/** Normalized, ready-to-apply form of an AI-reported downtime payout. */
export interface ParsedDowntimeRewards {
  gold: number
  items: RewardGrantItem[]
  standingChanges: StandingChange[]
  contacts: string[]
  /** Inputs that didn't match the documented shape, for logging. */
  skipped: string[]
}

/**
 * A reputation line as the prompt asks for it: "Faction Name: +2".
 * Split on the LAST colon so a faction whose name contains one
 * ("The Order: Ascendant") still parses its delta correctly.
 */
export function parseReputationLine(line: string): StandingChange | null {
  const idx = line.lastIndexOf(':')
  if (idx <= 0) return null

  const factionName = line.slice(0, idx).trim()
  const deltaText = line.slice(idx + 1).trim()
  if (!factionName) return null

  // Accept "+2", "-1", "2" — reject anything with stray text, rather than
  // parseInt's habit of reading "2 or maybe 3" as 2.
  if (!/^[+-]?\d+$/.test(deltaText)) return null

  const delta = parseInt(deltaText, 10)
  if (!Number.isFinite(delta) || delta === 0) return null

  return {
    faction_name: factionName,
    delta,
    reason: 'Downtime activity',
  }
}

/**
 * Pure: normalize the AI's loose outcomes blob into applyable rewards.
 * No DB access, so the messy string handling is testable on its own.
 */
export function parseDowntimeRewards(outcomes: unknown): ParsedDowntimeRewards {
  const result: ParsedDowntimeRewards = { gold: 0, items: [], standingChanges: [], contacts: [], skipped: [] }
  if (!outcomes || typeof outcomes !== 'object') return result

  const blob = outcomes as Record<string, any>
  const material = blob.materialRewards
  const relationships = blob.relationships

  // Gold — floored at 0 (a downtime payout is never a debit; entry costs
  // are charged separately and up front) and clamped by the same shared
  // magnitude guard every other reported gold value goes through.
  if (material && typeof material.goldGained === 'number') {
    result.gold = Math.max(0, clampGoldDelta(material.goldGained))
  }

  // Items are reported as bare names, so they land as plain quantity-1
  // misc items. Deliberately NOT given armorValue/damageBonus/effect: those
  // are mechanically live fields, and inferring them from a name string is
  // the keyword-guessing this codebase already rejected elsewhere.
  if (material && Array.isArray(material.itemsCreated)) {
    for (const raw of material.itemsCreated) {
      if (typeof raw !== 'string' || !raw.trim()) {
        result.skipped.push(`item: ${JSON.stringify(raw)}`)
        continue
      }
      const name = raw.trim()
      result.items.push({ id: slugifyCapabilityKey(name), name, quantity: 1, tags: ['downtime'], itemType: 'misc' })
    }
  }

  if (relationships && Array.isArray(relationships.reputationChanges)) {
    for (const raw of relationships.reputationChanges) {
      if (typeof raw !== 'string') {
        result.skipped.push(`reputation: ${JSON.stringify(raw)}`)
        continue
      }
      const parsed = parseReputationLine(raw)
      if (parsed) result.standingChanges.push(parsed)
      else result.skipped.push(`reputation: ${raw}`)
    }
  }

  if (relationships && Array.isArray(relationships.contactsGained)) {
    for (const raw of relationships.contactsGained) {
      if (typeof raw === 'string' && raw.trim()) result.contacts.push(raw.trim())
      else result.skipped.push(`contact: ${JSON.stringify(raw)}`)
    }
  }

  return result
}

/**
 * Apply parsed rewards to the one character who did the activity.
 *
 * Targets that character by id rather than going through
 * applyQuestRewardGrant's recipient resolution, which matches names with
 * `contains` — the exact pattern removed elsewhere in this engine (#3/#40)
 * for cross-matching "Bob" onto "Bobby's Assistant". The primitives it
 * uses (mergeGrantedItems, clampGoldDelta, applyStandingChanges) are the
 * same ones quest payouts use, so both paths move gold, items and standing
 * through identical, already-tested logic.
 *
 * Returns human-readable log lines.
 */
export async function applyDowntimeRewards(
  db: Db,
  campaignId: string,
  characterId: string,
  activityLabel: string,
  rewards: ParsedDowntimeRewards,
  // #211: required to run item grants through the same per-arc rarity
  // budget quest rewards enforce (applyGrantBudget) — without it, downtime
  // completions were the one reward path with no cap on item quality/
  // quantity per arc. Optional only so a caller with genuinely no turn
  // context (shouldn't happen via the real call site) degrades to
  // ungated grants rather than throwing.
  currentTurn?: number
): Promise<string[]> {
  const log: string[] = []
  const hasAnything =
    rewards.gold > 0 ||
    rewards.items.length > 0 ||
    rewards.standingChanges.length > 0 ||
    rewards.contacts.length > 0
  if (!hasAnything) return log

  const character = await db.character.findUnique({
    where: { id: characterId },
    select: { id: true, name: true, resources: true, inventory: true, isAlive: true },
  })

  if (!character) {
    console.warn(`  ❓ downtime rewards for "${activityLabel}": character ${characterId} not found — skipped`)
    return log
  }

  const updateData: Record<string, unknown> = {}
  const resources = (character.resources as any) || { gold: 0, contacts: [] }

  if (rewards.gold > 0) {
    resources.gold = Math.max(0, (resources.gold || 0) + rewards.gold)
    updateData.resources = resources
    log.push(`${character.name} earned ${rewards.gold} gold from "${activityLabel}"`)
  }

  if (rewards.contacts.length > 0) {
    const existing: string[] = Array.isArray(resources.contacts) ? resources.contacts : []
    resources.contacts = Array.from(new Set([...existing, ...rewards.contacts]))
    updateData.resources = resources
    log.push(`${character.name} made contacts: ${rewards.contacts.join(', ')}`)
  }

  if (rewards.items.length > 0) {
    // Per-arc rarity budget (#44/#47/#211), same as questRewards.ts's
    // applyQuestRewardGrant — a downtime completion is no longer a way to
    // grant items outside the cap every other reward path enforces.
    let toGrant = rewards.items
    if (typeof currentTurn === 'number') {
      const existing = ((character.inventory as any)?.items || []) as Array<{ rarity?: string | null; grantedTurn?: number | null }>
      const budget = applyGrantBudget(existing, toGrant, currentTurn)
      for (const skippedItem of budget.skipped) {
        log.push(`${skippedItem.name} was earned but is beyond what ${character.name} has earned this arc`)
      }
      toGrant = budget.granted.map(item => ({ ...item, grantedTurn: currentTurn }))
    }

    if (toGrant.length > 0) {
      updateData.inventory = mergeGrantedItems(character.inventory as any, toGrant)
      log.push(`${character.name} acquired ${toGrant.map(i => i.name).join(', ')} from "${activityLabel}"`)
    }
  }

  if (Object.keys(updateData).length > 0) {
    await db.character.update({ where: { id: character.id }, data: updateData })
  }

  if (rewards.standingChanges.length > 0) {
    // Standing goes through the same writer pc_changes uses, which enforces
    // its own per-scene and absolute bounds — this path gets those for free
    // rather than reimplementing them.
    await applyStandingChanges(db, campaignId, character.id, character.name, rewards.standingChanges, log)
  }

  if (rewards.skipped.length > 0) {
    console.warn(`  ⚠️ downtime rewards for "${activityLabel}": skipped unparseable ${rewards.skipped.join('; ')}`)
  }

  return log
}
