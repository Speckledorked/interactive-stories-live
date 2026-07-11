// src/lib/game/tick/warTick.ts
// World Sim Phase 5 — sustained multi-turn conflict.
//
// Everything built through Phase 4 (ambitions, collapse, territory) is a
// one-shot event: a Clock resolves once and it's over. A war is different
// on purpose — it persists across many turns, accumulates momentum from
// both sides' relative strength, and both sides bleed resources/military
// the whole time it drags on, regardless of who's winning. It's the
// escalation of an existing contest, not a standalone trigger: a location
// has to already be contested (via a prior EXPAND or DESTABILIZE_RIVAL —
// see territory.ts) before a war over it can ignite.
//
// Runs after tickFactions/tickFactionLeadership in the handler order (see
// worldTick.ts) so it reads this turn's post-drift military/resources, and
// before tickFactionAmbitions so a faction already committed to a war this
// turn doesn't also spawn an unrelated ambition Clock on the same tick.
//
// Reads Location.isContested as of the START of this turn — contests
// created by an ambition resolving THIS turn (in worldTurn.ts, which runs
// after the deterministic tick) won't be visible for war declaration until
// next turn. Same one-tick lag already accepted for relationships/goal
// reassessment in Phase 3, for the same reason: avoids a same-turn circular
// dependency without needing a two-pass tick.

import { prisma } from '@/lib/prisma'
import { TickContext, TickHandlerResult, WorldChange, clamp, stableHash } from './types'

const WAR_MILITARY_THRESHOLD = 67 // matches factionTick.ts's band() HIGH cutoff — both sides must be genuinely strong
const WAR_DECISIVE_MOMENTUM = 60
const WAR_MAX_DURATION = 10 // ticks before an inconclusive war is called a stalemate
const ATTRITION_RESOURCES = 3
const ATTRITION_MILITARY = 2

export interface WarDeclarationDecision {
  shouldDeclare: boolean
  contestedLocationId?: string
}

/** Pure decision function — no DB access, safe to unit test directly. */
export function decideWarDeclaration(
  attacker: { id: string; military: number },
  defender: { id: string; military: number },
  contestedLocations: Array<{ id: string; ownerFactionId: string | null; isContested: boolean }>
): WarDeclarationDecision {
  if (attacker.military < WAR_MILITARY_THRESHOLD || defender.military < WAR_MILITARY_THRESHOLD) {
    return { shouldDeclare: false }
  }

  const prize = contestedLocations
    .filter((l) => l.ownerFactionId === defender.id && l.isContested)
    .sort((a, b) => a.id.localeCompare(b.id))[0]

  if (!prize) return { shouldDeclare: false }
  return { shouldDeclare: true, contestedLocationId: prize.id }
}

export interface WarProgressDecision {
  momentumDelta: number
  attackerResourceDelta: number
  attackerMilitaryDelta: number
  defenderResourceDelta: number
  defenderMilitaryDelta: number
}

// Momentum tracks the tug-of-war: whichever side has more military this
// turn pulls it their way, plus a small deterministic swing (seeded by the
// war+turn pair, not Math.random()) so it isn't purely a foregone
// conclusion from turn one. Both sides pay attrition every turn regardless
// of momentum — there's no free way to sit in a war.
/** Pure decision function — no DB access, safe to unit test directly. */
export function decideWarProgress(
  war: { id: string },
  attacker: { military: number },
  defender: { military: number },
  turnNumber: number
): WarProgressDecision {
  const militaryEdge = attacker.military - defender.military // -100..100
  const variance = (stableHash(`${war.id}:${turnNumber}`) % 21) - 10 // -10..10
  const momentumDelta = clamp(Math.round(militaryEdge * 0.2) + variance, -20, 20)

  return {
    momentumDelta,
    attackerResourceDelta: -ATTRITION_RESOURCES,
    attackerMilitaryDelta: -ATTRITION_MILITARY,
    defenderResourceDelta: -ATTRITION_RESOURCES,
    defenderMilitaryDelta: -ATTRITION_MILITARY,
  }
}

export interface WarResolutionDecision {
  resolves: boolean
  outcome: 'attacker' | 'defender' | 'stalemate' | null
}

/** Pure decision function — no DB access, safe to unit test directly. */
export function decideWarResolution(momentumAfterProgress: number, turnsElapsed: number): WarResolutionDecision {
  if (Math.abs(momentumAfterProgress) >= WAR_DECISIVE_MOMENTUM) {
    return { resolves: true, outcome: momentumAfterProgress > 0 ? 'attacker' : 'defender' }
  }
  if (turnsElapsed >= WAR_MAX_DURATION) {
    return { resolves: true, outcome: 'stalemate' }
  }
  return { resolves: false, outcome: null }
}

export async function tickWars(ctx: TickContext): Promise<TickHandlerResult> {
  const changes: WorldChange[] = []

  const activeWars = await prisma.war.findMany({
    where: { campaignId: ctx.campaignId, status: 'ESCALATING' },
    include: { attacker: true, defender: true },
  })

  const factionIdsAtWar = new Set<string>()

  for (const war of activeWars) {
    factionIdsAtWar.add(war.attackerFactionId)
    factionIdsAtWar.add(war.defenderFactionId)

    // A side that collapsed mid-war ends it outright — there's no one left
    // to fight. The survivor (if any) simply keeps whatever it already held.
    if (!war.attacker.isActive || !war.defender.isActive) {
      if (!ctx.dryRun) {
        await prisma.war.update({
          where: { id: war.id },
          data: { status: 'RESOLVED', outcome: 'stalemate', resolvedTurn: ctx.turnNumber },
        })
        if (war.contestedLocationId) {
          await prisma.location.update({ where: { id: war.contestedLocationId }, data: { isContested: false } })
        }
      }
      changes.push({
        entityType: 'FACTION',
        entityId: war.attacker.isActive ? war.attackerFactionId : war.defenderFactionId,
        entityName: war.attacker.isActive ? war.attacker.name : war.defender.name,
        campaignId: ctx.campaignId,
        field: 'warEnded',
        previousValue: 'escalating',
        newValue: 'ended',
        reason: `The war between ${war.attacker.name} and ${war.defender.name} ends when one side collapses`,
        significant: true,
        importance: 'MAJOR',
      })
      continue
    }

    const progress = decideWarProgress(war, war.attacker, war.defender, ctx.turnNumber)
    const newMomentum = clamp(war.momentum + progress.momentumDelta, -100, 100)

    if (!ctx.dryRun) {
      await prisma.faction.update({
        where: { id: war.attackerFactionId },
        data: {
          resources: clamp(war.attacker.resources + progress.attackerResourceDelta, 0, 100),
          military: clamp(war.attacker.military + progress.attackerMilitaryDelta, 0, 100),
        },
      })
      await prisma.faction.update({
        where: { id: war.defenderFactionId },
        data: {
          resources: clamp(war.defender.resources + progress.defenderResourceDelta, 0, 100),
          military: clamp(war.defender.military + progress.defenderMilitaryDelta, 0, 100),
        },
      })
    }

    const turnsElapsed = ctx.turnNumber - war.startedTurn
    const resolution = decideWarResolution(newMomentum, turnsElapsed)

    if (!resolution.resolves) {
      if (!ctx.dryRun) {
        await prisma.war.update({ where: { id: war.id }, data: { momentum: newMomentum } })
      }
      continue
    }

    if (!ctx.dryRun) {
      await prisma.war.update({
        where: { id: war.id },
        data: { momentum: newMomentum, status: 'RESOLVED', outcome: resolution.outcome, resolvedTurn: ctx.turnNumber },
      })
    }

    let contestedLocationName: string | null = null
    if (war.contestedLocationId) {
      const contestedLocation = await prisma.location.findUnique({ where: { id: war.contestedLocationId } })
      contestedLocationName = contestedLocation?.name ?? null

      if (!ctx.dryRun) {
        if (resolution.outcome === 'attacker') {
          await prisma.location.update({
            where: { id: war.contestedLocationId },
            data: { ownerFactionId: war.attackerFactionId, isContested: false },
          })
        } else {
          // Defender holds, or it's a stalemate — either way the siege lifts.
          await prisma.location.update({ where: { id: war.contestedLocationId }, data: { isContested: false } })
        }
      }
    }

    // The losing side takes a stability hit beyond the attrition it already
    // paid every turn — losing a war costs more than fighting one.
    if (!ctx.dryRun) {
      if (resolution.outcome === 'attacker') {
        await prisma.faction.update({ where: { id: war.defenderFactionId }, data: { stability: clamp(war.defender.stability - 10, 0, 100) } })
      } else if (resolution.outcome === 'defender') {
        await prisma.faction.update({ where: { id: war.attackerFactionId }, data: { stability: clamp(war.attacker.stability - 10, 0, 100) } })
      }
    }

    const reasonByOutcome = {
      attacker: `${war.attacker.name} wins its war against ${war.defender.name}${contestedLocationName ? `, seizing ${contestedLocationName}` : ''}`,
      defender: `${war.defender.name} repels ${war.attacker.name}'s war, holding its ground`,
      stalemate: `The war between ${war.attacker.name} and ${war.defender.name} grinds to a stalemate after ${turnsElapsed} turns`,
    } as const

    changes.push({
      entityType: 'FACTION',
      entityId: war.attackerFactionId,
      entityName: war.attacker.name,
      campaignId: ctx.campaignId,
      field: 'warResolved',
      previousValue: 'escalating',
      newValue: resolution.outcome!,
      reason: reasonByOutcome[resolution.outcome!],
      significant: true,
      importance: 'MAJOR',
    })
  }

  // Declare new wars among rival pairs not already fighting each other,
  // where one side's territory is already contested by the other.
  const factions = await prisma.faction.findMany({
    where: { campaignId: ctx.campaignId, isActive: true },
    orderBy: { createdAt: 'asc' },
    take: ctx.factionCap,
  })

  const locations = await prisma.location.findMany({
    where: { campaignId: ctx.campaignId },
    select: { id: true, name: true, ownerFactionId: true, isContested: true },
  })

  for (const defender of factions) {
    if (factionIdsAtWar.has(defender.id)) continue

    const relationships = (defender.relationships as any as Record<string, { type: string }>) || {}
    const rivalId = Object.entries(relationships).find(([, r]) => r.type === 'RIVAL')?.[0]
    if (!rivalId || factionIdsAtWar.has(rivalId)) continue

    const attacker = factions.find((f) => f.id === rivalId)
    if (!attacker) continue

    const decision = decideWarDeclaration(attacker, defender, locations)
    if (!decision.shouldDeclare) continue

    const prizeLocation = locations.find((l) => l.id === decision.contestedLocationId)

    if (!ctx.dryRun) {
      await prisma.war.create({
        data: {
          campaignId: ctx.campaignId,
          name: prizeLocation ? `War for ${prizeLocation.name}` : `${attacker.name} vs. ${defender.name}`,
          attackerFactionId: attacker.id,
          defenderFactionId: defender.id,
          contestedLocationId: decision.contestedLocationId,
          startedTurn: ctx.turnNumber,
        },
      })
    }

    factionIdsAtWar.add(attacker.id)
    factionIdsAtWar.add(defender.id)

    changes.push({
      entityType: 'FACTION',
      entityId: attacker.id,
      entityName: attacker.name,
      campaignId: ctx.campaignId,
      field: 'warDeclared',
      previousValue: 'rivals',
      newValue: 'at war',
      reason: `${attacker.name} declares war on ${defender.name}, both sides strong enough to see it through`,
      significant: true,
      importance: 'MAJOR',
    })
  }

  return { changes }
}
