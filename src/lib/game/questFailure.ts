// src/lib/game/questFailure.ts
//
// What a failed quest costs (the open half of #45/#75).
//
// `#45`/`#75` gave quests the structure to have consequences — a stable
// `objectiveKey` and a real FK to the commissioning NPC or faction — and
// then FAILED/ABANDONED stayed inert, because "what failure costs" is game
// design rather than plumbing. This is the answer: **the cost is
// contextual, and the context is state the engine already owns.**
//
// That distinction is the whole design. "Contextual" here does NOT mean the
// narrator picks a penalty per situation — that is the unbounded
// AI-authored mechanical change this codebase refuses everywhere else
// (see the reasoning on reward_grant, harm_healing and rest_quality). It
// means the engine derives the cost from who commissioned the job and how
// it ended, deterministically, the same way tension, weather and faction
// drift are derived rather than reported.
//
// Two outcomes, and they are genuinely different failures:
//
//   ABANDONED — you walked away. That is a broken commitment, so it costs
//   TRUST, and it is the only one that moves faction standing.
//
//   FAILED — you tried and lost. That costs RESPECT and nothing else. An
//   honest attempt should not read as a betrayal, and a system that
//   punished both identically would teach players to abandon quietly
//   rather than fail publicly.
//
// The split is by WHICH METER rather than by magnitude, on purpose.
// Standing is a coarse -3..+3 scale where the smallest step is a whole
// point, so making both outcomes move it differs only in that one is
// worse — whereas trust and respect are separate 0-100 meters that already
// feed `relationshipModifier` independently. Using them says something
// true about the fiction instead of just scaling a number.

// The -3..+3 track bounds live in standing.ts, which owns the track. #413:
// they were duplicated here, so a widening there would silently not apply
// to quest failure — the one place that pushes standing DOWN hardest.
import { STANDING_MIN, STANDING_MAX } from '@/lib/game/standing'

/** The two ways a quest ends badly. COMPLETED is handled by questRewards. */
export type QuestFailureStatus = 'FAILED' | 'ABANDONED'

export interface QuestFailureCost {
  /** Standing delta with the giver faction. Zero for an honest failure. */
  standingDelta: number
  /** Rapport deltas with the giver NPC, on the 0-100 per-meter scale. */
  trustDelta: number
  respectDelta: number
  /** Diegetic phrasing for the log and the history entry. */
  reason: string
}

/**
 * Walking away costs standing. Deliberately the only outcome that does:
 * standing is coarse enough that it should move for a betrayal and not for
 * a defeat.
 */
export const ABANDON_STANDING_DELTA = -1
export const ABANDON_TRUST_DELTA = -25
export const ABANDON_RESPECT_DELTA = -10

/** Losing costs respect only. You were not up to it; you did not lie. */
export const FAILED_RESPECT_DELTA = -15

export function decideQuestFailureCost(
  status: QuestFailureStatus,
  questName: string
): QuestFailureCost {
  if (status === 'ABANDONED') {
    return {
      standingDelta: ABANDON_STANDING_DELTA,
      trustDelta: ABANDON_TRUST_DELTA,
      respectDelta: ABANDON_RESPECT_DELTA,
      reason: `walked away from "${questName}"`,
    }
  }

  return {
    standingDelta: 0,
    trustDelta: 0,
    respectDelta: FAILED_RESPECT_DELTA,
    reason: `failed "${questName}"`,
  }
}

/**
 * Is there anyone to be let down?
 *
 * A quest whose giver never resolved to a real entity costs nothing, and
 * that guard is load-bearing rather than defensive: `givenBy` is free text
 * and the fuzzy resolver deliberately returns nothing on an ambiguous
 * match (see resolveQuestGiver). Charging standing to a best guess would
 * land real consequences on an innocent faction — the exact failure that
 * reasoning was written to avoid, one system downstream.
 */
export function hasQuestGiver(quest: {
  givenByNpcId?: string | null
  givenByFactionId?: string | null
}): boolean {
  return Boolean(quest?.givenByNpcId || quest?.givenByFactionId)
}

// ---------------------------------------------------------------------------
// Applying the cost
// ---------------------------------------------------------------------------

interface Db {
  character: {
    findMany: (args: unknown) => Promise<Array<{ id: string; name: string; relationships: unknown }>>
    update: (args: unknown) => Promise<unknown>
  }
  factionStanding: {
    findUnique: (args: unknown) => Promise<{ value: number } | null>
    upsert: (args: unknown) => Promise<unknown>
  }
}

/** Rapport meters run -100..100, matching the pc_changes relationship writer. */
const clampRapport = (value: number) => Math.max(-100, Math.min(100, value))

/**
 * Charge a failed quest to the party.
 *
 * **To every living player character**, which is the honest reading of a
 * party-level commitment: `FactionStanding` and `Character.relationships`
 * are both per-character, while a Quest belongs to the campaign and has no
 * participant link. The party took the job together, so the party is who
 * the giver holds responsible. (Narrowing this to "whoever was in the scene
 * where it failed" would need a quest-participant model that does not
 * exist, and inventing one to make a penalty more precise is a worse trade
 * than charging the group.)
 *
 * Returns log lines. Never throws: a consequence failing to land must not
 * roll back the quest's own status change.
 */
export async function applyQuestFailureCost(
  db: Db,
  campaignId: string,
  quest: {
    name: string
    givenByNpcId?: string | null
    givenByFactionId?: string | null
  },
  status: QuestFailureStatus
): Promise<string[]> {
  if (!hasQuestGiver(quest)) return []

  const cost = decideQuestFailureCost(status, quest.name)
  const log: string[] = []

  const characters = await db.character.findMany({
    where: { campaignId, isAlive: true },
    select: { id: true, name: true, relationships: true },
  })
  if (characters.length === 0) return []

  // A faction giver: standing, but only for a walk-away.
  if (quest.givenByFactionId && cost.standingDelta !== 0) {
    for (const character of characters) {
      const existing = await db.factionStanding.findUnique({
        where: { characterId_factionId: { characterId: character.id, factionId: quest.givenByFactionId } },
        select: { value: true },
      })
      const current = existing?.value ?? 0
      const next = Math.max(STANDING_MIN, Math.min(STANDING_MAX, current + cost.standingDelta))
      if (next === current) continue

      await db.factionStanding.upsert({
        where: { characterId_factionId: { characterId: character.id, factionId: quest.givenByFactionId } },
        create: { campaignId, characterId: character.id, factionId: quest.givenByFactionId, value: next },
        update: { value: next },
      })
      log.push(`${character.name} standing ${current} → ${next} — ${cost.reason}`)
    }
  }

  // An NPC giver: rapport with the person who asked.
  if (quest.givenByNpcId && (cost.trustDelta !== 0 || cost.respectDelta !== 0)) {
    for (const character of characters) {
      const relationships = (character.relationships as Record<string, Record<string, number>> | null) || {}
      const current = relationships[quest.givenByNpcId] || { trust: 0, tension: 0, respect: 0, fear: 0 }

      relationships[quest.givenByNpcId] = {
        ...current,
        trust: clampRapport((Number(current.trust) || 0) + cost.trustDelta),
        respect: clampRapport((Number(current.respect) || 0) + cost.respectDelta),
      }

      await db.character.update({
        where: { id: character.id },
        data: { relationships },
      })
      log.push(`${character.name} lost standing with the quest-giver — ${cost.reason}`)
    }
  }

  return log
}
