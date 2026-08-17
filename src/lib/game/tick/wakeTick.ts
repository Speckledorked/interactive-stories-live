// src/lib/game/tick/wakeTick.ts
// World Sim #103 — institutional memory decay after death or dissolution.
//
// Today an NPC's death or a faction's collapse takes effect immediately
// and nothing else ever reacts to it again — a legend or an institution
// "doesn't stop mattering the instant it's gone," but the simulation
// treated it as though it did. This adds a bounded, TEMPORARY stability
// ripple that fades back out over a fixed number of turns, so the loss is
// felt for a while rather than forgotten the same tick it happens.
//
// Two independent triggers, both DETECTED here rather than reacted to as
// an event: NPC death (worldUpdaters/npcs.ts, an entirely different
// transaction than the world tick — see the comment on tickWake below) and
// faction collapse (tickFactions, same tick, same transaction). Neither
// pushes an explicit "something died" signal into this handler; instead
// tickWake queries for isAlive:false / isActive:false rows that don't yet
// have an ActiveWake row and treats those as fresh. Once a row exists for
// a given (source, affected faction) pair, it can never be created again —
// the ActiveWake @@unique constraint (schema.prisma) makes this idempotent
// by construction, same defensive convention Phase 1b established for
// check-then-act name claims elsewhere.
//
// Succession (leadershipTick.ts, #112) is NOT a trigger of its own — a
// faction's leader changing while the faction itself stays active isn't a
// loss to the world, just a promotion. It only ever shows up here as a
// LOOKUP: if the NPC who died happened to be a LEADER and this same tick's
// tickFactionLeadership already computed how rough replacing them was
// (ctx.successionRoughnessByFactionId), that roughness scales this wake's
// penalty instead of tickWake computing "how bad was this" a second,
// independent way. This is also what keeps a leadership change from ever
// double-applying decay: only the NPC's death creates a wake row; the
// succession that followed it is read, never re-triggered.

// roster-exempt: a wake ripples to everyone the death or collapse actually
// touched. Restricting the ripple to the roster would mean a faction's
// grief depends on rotation, and ActiveWake's decay schedule (its own
// @@unique idempotency) assumes every affected party got a row.

import { TickContext, TickHandlerResult, WorldChange, clamp } from './types'
import { TIE_INCLUDE, factionTies } from '../tieGraph'
import { MAJOR_IMPORTANCE_THRESHOLD } from './npcTick'
import { isUniqueConstraintViolation } from '../worldUpdaters/uniqueConstraintGuard'

// How many turns a wake's stability penalty takes to fully fade back out.
const WAKE_DURATION_TURNS = 5

// Base magnitude (before roughness/leader scaling) for an ordinary member's
// death — same rough scale as locationConditionTick's WAR_DAMAGE (8) and
// CONTEST_STRAIN (2), since both represent "how hard did this tick hit a
// faction's standing."
const NPC_DEATH_BASE_PENALTY = 6
// Losing a LEADER is a bigger shock to a faction than losing a member.
const LEADER_DEATH_MULTIPLIER = 1.5
// Base magnitude for the ripple a collapse sends to related (rival/ally)
// factions — smaller than losing your own member, since this is a
// secondary shockwave, not a direct loss.
const COLLAPSE_RIPPLE_BASE_PENALTY = 5
// Used when no #112 roughness signal is available this tick — an
// already-old death/collapse from before wake support existed, or a
// member death with no succession to reuse. 0.4 keeps the penalty
// meaningfully non-trivial without assuming the worst case.
const DEFAULT_ROUGHNESS = 0.4
// One-time (not decayed) setback to a grieving colleague's progress toward
// their own goal — applied once, at creation, only to other living major
// NPCs sharing the dead NPC's faction.
const GOAL_PROGRESS_PENALTY = 15

export interface WakeSource {
  sourceType: 'NPC' | 'FACTION'
  /** 0-1 — from #112's collapseRoughness/successionRoughness when this
   * tick computed one, DEFAULT_ROUGHNESS otherwise. */
  roughness: number
  /** Only meaningful when sourceType is 'NPC' — losing a faction's LEADER
   * hits harder than losing an ordinary member. */
  wasLeader?: boolean
}

/**
 * Pure — the flat stability penalty ONE wake ripple applies to ONE
 * affected faction. Applied to Faction.stability in full, in one step, the
 * moment the ActiveWake row is created; decideWakeDecayStep below then
 * gradually restores exactly this amount over WAKE_DURATION_TURNS turns.
 */
export function decideWakeStabilityPenalty(source: WakeSource): number {
  if (source.sourceType === 'NPC') {
    const magnitude = NPC_DEATH_BASE_PENALTY * (0.5 + source.roughness) * (source.wasLeader ? LEADER_DEATH_MULTIPLIER : 1)
    return -Math.round(magnitude)
  }
  const magnitude = COLLAPSE_RIPPLE_BASE_PENALTY * (0.5 + source.roughness)
  return -Math.round(magnitude)
}

export interface WakeDecayInput {
  totalStabilityPenalty: number
  currentTicks: number
  maxTicks: number
}

export interface WakeDecayResult {
  nextCurrentTicks: number
  /** Positive — how much stability to restore this turn. */
  restoreAmount: number
  resolved: boolean
}

/**
 * Pure — one turn's worth of a wake fading back out. Divides the total
 * penalty evenly across maxTicks turns, EXCEPT the final turn, which
 * restores whatever rounding left over instead of a fixed share — so the
 * running total restored across a wake's whole lifetime always equals
 * exactly the original penalty, never a rounding residual left stranded.
 */
export function decideWakeDecayStep(wake: WakeDecayInput): WakeDecayResult {
  const nextCurrentTicks = wake.currentTicks + 1
  const totalMagnitude = Math.abs(wake.totalStabilityPenalty)
  const perTurnRestore = Math.round(totalMagnitude / wake.maxTicks)
  const resolved = nextCurrentTicks >= wake.maxTicks
  const restoreAmount = resolved ? totalMagnitude - perTurnRestore * (wake.maxTicks - 1) : perTurnRestore
  return { nextCurrentTicks, restoreAmount, resolved }
}

export async function tickWake(ctx: TickContext): Promise<TickHandlerResult> {
  const changes: WorldChange[] = []

  // 1. Decay wakes created on a PRIOR tick. Done first so a wake created
  // later in THIS same pass (steps 2/3 below) never also gets a decay step
  // applied the same turn it was born.
  const activeWakes = await ctx.db.activeWake.findMany({
    where: { campaignId: ctx.campaignId, resolvedAt: null },
  })
  for (const wake of activeWakes) {
    const step = decideWakeDecayStep(wake)
    if (!ctx.dryRun) {
      const faction = await ctx.db.faction.findUnique({ where: { id: wake.affectedFactionId }, select: { stability: true } })
      if (faction) {
        await ctx.db.faction.update({
          where: { id: wake.affectedFactionId },
          data: { stability: clamp(faction.stability + step.restoreAmount, 0, 100) },
        })
      }
      await ctx.db.activeWake.update({
        where: { id: wake.id },
        data: { currentTicks: step.nextCurrentTicks, resolvedAt: step.resolved ? new Date() : null },
      })
    }
  }

  // 2. Detect NPC deaths not yet processed — death itself happens in a
  // completely different transaction (worldUpdaters/npcs.ts, mid-scene,
  // not on the tick's own cadence), so there is no "diedThisTurn" event to
  // subscribe to; this just asks "which dead NPCs have no wake row yet."
  const deadNpcs = await ctx.db.nPC.findMany({
    where: { campaignId: ctx.campaignId, isAlive: false, factionId: { not: null } },
    select: { id: true, name: true, factionId: true, factionRole: true },
  })

  if (deadNpcs.length > 0) {
    const alreadyProcessedNpcIds = new Set(
      (
        await ctx.db.activeWake.findMany({
          where: { campaignId: ctx.campaignId, sourceType: 'NPC', sourceEntityId: { in: deadNpcs.map((n) => n.id) } },
          select: { sourceEntityId: true },
        })
      ).map((w) => w.sourceEntityId)
    )

    for (const npc of deadNpcs) {
      if (alreadyProcessedNpcIds.has(npc.id) || !npc.factionId) continue

      const faction = await ctx.db.faction.findUnique({
        where: { id: npc.factionId },
        select: { id: true, name: true, stability: true, isActive: true },
      })
      // The faction itself is already gone (or was reassigned away) —
      // nothing left here to destabilize.
      if (!faction || !faction.isActive) continue

      const wasLeader = npc.factionRole === 'LEADER'
      const roughness = (wasLeader ? ctx.successionRoughnessByFactionId?.get(npc.factionId) : undefined) ?? DEFAULT_ROUGHNESS
      const stabilityPenalty = decideWakeStabilityPenalty({ sourceType: 'NPC', roughness, wasLeader })
      const newStability = clamp(faction.stability + stabilityPenalty, 0, 100)

      if (!ctx.dryRun) {
        // #441: skipDuplicates, NOT catch-and-continue.
        //
        // The intent was right and the mechanism could not work. This runs on
        // ctx.db — the tick's shared Prisma.TransactionClient — and in
        // Postgres a statement that raises inside a transaction puts the
        // whole transaction into an aborted state. Prisma opens no per-
        // statement savepoint, so there is nothing to roll back to: every
        // subsequent handler query fails with "current transaction is
        // aborted". The `continue` did not skip a duplicate wake and carry
        // on; it carried on into a transaction that could no longer execute
        // anything, turning a condition this code explicitly classifies as
        // benign into total loss of the world turn.
        //
        // ON CONFLICT DO NOTHING (what skipDuplicates compiles to) never
        // raises, so the transaction stays alive and `count` says whether
        // this pass is the one that owns the follow-up writes.
        const created = await ctx.db.activeWake.createMany({
          data: [{
            campaignId: ctx.campaignId,
            sourceType: 'NPC',
            sourceEntityId: npc.id,
            sourceEntityName: npc.name,
            affectedFactionId: faction.id,
            totalStabilityPenalty: stabilityPenalty,
            maxTicks: WAKE_DURATION_TURNS,
          }],
          skipDuplicates: true,
        })
        // Already handled by another pass — do not double-apply the penalty.
        if (created.count === 0) continue

        await ctx.db.faction.update({ where: { id: faction.id }, data: { stability: newStability } })

        // One-time goal-progress setback for grieving colleagues — other
        // living MAJOR NPCs in the same faction, not decayed/restored like
        // the stability ripple above (a delayed plan doesn't "fade back
        // in" the same way a shaken institution's confidence does).
        const colleagues = await ctx.db.nPC.findMany({
          where: {
            campaignId: ctx.campaignId,
            factionId: faction.id,
            isAlive: true,
            importance: { gte: MAJOR_IMPORTANCE_THRESHOLD },
            id: { not: npc.id },
          },
          select: { id: true, goalProgress: true },
        })
        for (const colleague of colleagues) {
          await ctx.db.nPC.update({
            where: { id: colleague.id },
            data: { goalProgress: clamp(colleague.goalProgress - GOAL_PROGRESS_PENALTY, 0, 100) },
          })
        }
      }

      changes.push({
        entityType: 'FACTION',
        entityId: faction.id,
        entityName: faction.name,
        campaignId: ctx.campaignId,
        field: 'stability',
        previousValue: faction.stability,
        newValue: newStability,
        reason: wasLeader
          ? `${faction.name} reels from the loss of ${npc.name}, its leader`
          : `${faction.name} mourns the loss of ${npc.name}`,
        significant: true,
        importance: wasLeader ? 'MAJOR' : 'NORMAL',
        origin: 'wake',
        wakeSourceType: 'NPC',
      })
    }
  }

  // 3. Detect faction collapses not yet processed, rippling to related
  // (rival/ally) factions that are still active. Reads the collapsed
  // faction's OWN relationships JSON (untouched by collapse — only
  // isActive/stats change), the same source tickFactions itself already
  // reads to find a rival absorber.
  const collapsedFactions = await ctx.db.faction.findMany({
    where: { campaignId: ctx.campaignId, isActive: false },
    select: { id: true, name: true, ...TIE_INCLUDE },
  })

  if (collapsedFactions.length > 0) {
    const alreadyProcessedFactionIds = new Set(
      (
        await ctx.db.activeWake.findMany({
          where: { campaignId: ctx.campaignId, sourceType: 'FACTION', sourceEntityId: { in: collapsedFactions.map((f) => f.id) } },
          select: { sourceEntityId: true },
        })
      ).map((w) => w.sourceEntityId)
    )

    for (const collapsed of collapsedFactions) {
      if (alreadyProcessedFactionIds.has(collapsed.id)) continue

      const relatedIds = Object.keys(factionTies(collapsed))
      if (relatedIds.length === 0) continue

      const relatedFactions = await ctx.db.faction.findMany({
        where: { id: { in: relatedIds }, isActive: true },
        select: { id: true, name: true, stability: true },
      })
      if (relatedFactions.length === 0) continue

      const roughness = ctx.collapseRoughnessByFactionId?.get(collapsed.id) ?? DEFAULT_ROUGHNESS
      const stabilityPenalty = decideWakeStabilityPenalty({ sourceType: 'FACTION', roughness })

      for (const related of relatedFactions) {
        const newStability = clamp(related.stability + stabilityPenalty, 0, 100)

        if (!ctx.dryRun) {
          // #441: see the NPC-wake creation above for why this is
          // skipDuplicates rather than catch-and-continue.
          const created = await ctx.db.activeWake.createMany({
            data: [{
              campaignId: ctx.campaignId,
              sourceType: 'FACTION',
              sourceEntityId: collapsed.id,
              sourceEntityName: collapsed.name,
              affectedFactionId: related.id,
              totalStabilityPenalty: stabilityPenalty,
              maxTicks: WAKE_DURATION_TURNS,
            }],
            skipDuplicates: true,
          })
          if (created.count === 0) continue

          await ctx.db.faction.update({ where: { id: related.id }, data: { stability: newStability } })
        }

        changes.push({
          entityType: 'FACTION',
          entityId: related.id,
          entityName: related.name,
          campaignId: ctx.campaignId,
          field: 'stability',
          previousValue: related.stability,
          newValue: newStability,
          reason: `${related.name} feels the shockwaves of ${collapsed.name}'s collapse`,
          significant: true,
          importance: 'NORMAL',
          origin: 'wake',
          wakeSourceType: 'FACTION',
        })
      }
    }
  }

  return { changes }
}
