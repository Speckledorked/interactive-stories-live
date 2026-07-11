// src/lib/game/tick/warTick.ts
// World Sim Phase 5 — sustained multi-turn conflict. Coalitions added later.
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
// Coalitions: a war always DECLARES as strictly 1v1. From there, each tick,
// a side's existing ALLY factions (Faction.relationships) can be pulled in
// as additional WarParticipant rows if they're strong enough and not
// already committed to any other war — reusing the ALLY relationship type
// Phase 3 already computes but never gave any mechanical weight to before
// now. Momentum/attrition operate on the whole side (sum of all living
// participants' military; attrition paid by every living participant), but
// the contested-territory prize still goes only to the original
// attackerFactionId — an ally fighting alongside doesn't inherit land it
// never personally claimed.
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
// dependency without needing a two-pass tick. New allies pulled in this
// tick, and wars declared this tick, don't get evaluated again until next
// tick either, for the same reason.

import { prisma } from '@/lib/prisma'
import { TickContext, TickHandlerResult, WorldChange, clamp, stableHash } from './types'

const WAR_MILITARY_THRESHOLD = 67 // matches factionTick.ts's band() HIGH cutoff — both sides must be genuinely strong
const WAR_DECISIVE_MOMENTUM = 60
const WAR_MAX_DURATION = 10 // ticks before an inconclusive war is called a stalemate
const ATTRITION_RESOURCES = 3
const ATTRITION_MILITARY = 2
const MAX_JOINERS_PER_SIDE_PER_TICK = 1 // a war spreads gradually, not all at once

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

// Momentum tracks the tug-of-war: whichever SIDE has more total military
// this turn pulls it their way, plus a small deterministic swing (seeded by
// the war+turn pair, not Math.random()) so it isn't purely a foregone
// conclusion from turn one. Both sides pay attrition every turn regardless
// of momentum — there's no free way to sit in a war. Coalitions don't
// change this function's shape at all — the caller passes in each side's
// AGGREGATE military (sum across every living participant), not a single
// faction's, so a 3-faction coalition naturally hits harder than a lone
// combatant without this function needing to know how many factions make
// up either number.
/** Pure decision function — no DB access, safe to unit test directly. */
export function decideWarProgress(
  war: { id: string },
  attacker: { military: number },
  defender: { military: number },
  turnNumber: number
): WarProgressDecision {
  const militaryEdge = attacker.military - defender.military
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

export interface WarJoinCandidate {
  id: string
  name: string
  military: number
}

// Picks at most one ally to join a side this tick — a coalition grows one
// faction at a time, not in one instant blob. Deterministic: strongest
// eligible candidate wins, ties broken by id so the same input always
// produces the same pick.
/** Pure decision function — no DB access, safe to unit test directly. */
export function decideWarJoiner(candidates: WarJoinCandidate[]): WarJoinCandidate | null {
  const eligible = candidates.filter((c) => c.military >= WAR_MILITARY_THRESHOLD)
  if (eligible.length === 0) return null
  return eligible.sort((a, b) => b.military - a.military || a.id.localeCompare(b.id))[0]
}

export async function tickWars(ctx: TickContext): Promise<TickHandlerResult> {
  const changes: WorldChange[] = []

  const activeWars = await prisma.war.findMany({
    where: { campaignId: ctx.campaignId, status: 'ESCALATING' },
    include: {
      attacker: true,
      defender: true,
      participants: { include: { faction: true } },
    },
  })

  const factionIdsAtWar = new Set<string>()
  for (const war of activeWars) {
    for (const p of war.participants) factionIdsAtWar.add(p.factionId)
  }

  const resolvedWarIds = new Set<string>()

  for (const war of activeWars) {
    const attackerSide = war.participants.filter((p) => p.side === 'ATTACKER' && p.faction.isActive)
    const defenderSide = war.participants.filter((p) => p.side === 'DEFENDER' && p.faction.isActive)
    const sideDescriptor = (primary: string, side: typeof attackerSide) =>
      side.length > 1 ? `${primary} and ${side.length - 1} ${side.length === 2 ? 'ally' : 'allies'}` : primary

    // A side with zero living participants ends the war outright — there's
    // no one left to fight on that side. The survivor (if any) simply keeps
    // whatever it already held. Kept as a 'stalemate' outcome (not a win)
    // for the surviving side, same labeling the original 1v1 version used —
    // a side dying off mid-war isn't the same as being decisively beaten.
    if (attackerSide.length === 0 || defenderSide.length === 0) {
      resolvedWarIds.add(war.id)
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
        entityId: attackerSide.length > 0 ? war.attackerFactionId : war.defenderFactionId,
        entityName: attackerSide.length > 0 ? war.attacker.name : war.defender.name,
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

    const attackerMilitaryTotal = attackerSide.reduce((sum, p) => sum + p.faction.military, 0)
    const defenderMilitaryTotal = defenderSide.reduce((sum, p) => sum + p.faction.military, 0)

    const progress = decideWarProgress(war, { military: attackerMilitaryTotal }, { military: defenderMilitaryTotal }, ctx.turnNumber)
    const newMomentum = clamp(war.momentum + progress.momentumDelta, -100, 100)

    // Attrition applies to every living participant on both sides, not just
    // the original two — a coalition shares the cost of fighting.
    if (!ctx.dryRun) {
      for (const p of attackerSide) {
        await prisma.faction.update({
          where: { id: p.factionId },
          data: {
            resources: clamp(p.faction.resources + progress.attackerResourceDelta, 0, 100),
            military: clamp(p.faction.military + progress.attackerMilitaryDelta, 0, 100),
          },
        })
      }
      for (const p of defenderSide) {
        await prisma.faction.update({
          where: { id: p.factionId },
          data: {
            resources: clamp(p.faction.resources + progress.defenderResourceDelta, 0, 100),
            military: clamp(p.faction.military + progress.defenderMilitaryDelta, 0, 100),
          },
        })
      }
    }

    const turnsElapsed = ctx.turnNumber - war.startedTurn
    const resolution = decideWarResolution(newMomentum, turnsElapsed)

    if (!resolution.resolves) {
      if (!ctx.dryRun) {
        await prisma.war.update({ where: { id: war.id }, data: { momentum: newMomentum } })
      }
      continue
    }

    resolvedWarIds.add(war.id)

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
          // The prize goes only to the original attacker — an ally fighting
          // alongside doesn't inherit territory it never personally claimed.
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

    // The losing SIDE takes a stability hit beyond the attrition it already
    // paid every turn — losing a war costs more than fighting one. Applies
    // to every faction on the losing side, not just the primary — a
    // coalition shares the cost of losing too.
    if (!ctx.dryRun) {
      if (resolution.outcome === 'attacker') {
        for (const p of defenderSide) {
          await prisma.faction.update({ where: { id: p.factionId }, data: { stability: clamp(p.faction.stability - 10, 0, 100) } })
        }
      } else if (resolution.outcome === 'defender') {
        for (const p of attackerSide) {
          await prisma.faction.update({ where: { id: p.factionId }, data: { stability: clamp(p.faction.stability - 10, 0, 100) } })
        }
      }
    }

    const attackerDescriptor = sideDescriptor(war.attacker.name, attackerSide)
    const defenderDescriptor = sideDescriptor(war.defender.name, defenderSide)
    const reasonByOutcome = {
      attacker: `${attackerDescriptor} wins its war against ${defenderDescriptor}${contestedLocationName ? `, seizing ${contestedLocationName}` : ''}`,
      defender: `${defenderDescriptor} repels ${attackerDescriptor}'s war, holding its ground`,
      stalemate: `The war between ${attackerDescriptor} and ${defenderDescriptor} grinds to a stalemate after ${turnsElapsed} turns`,
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

  // Coalitions: let each side of an ongoing (not just-resolved) war pull in
  // one already-idle ally, if one is strong enough. A faction is eligible
  // only if it's allied with a CURRENT side member, active, meets the same
  // military bar declaration itself requires, and isn't already committed
  // to any war (this one or another) — factionIdsAtWar tracks that globally.
  for (const war of activeWars) {
    if (resolvedWarIds.has(war.id)) continue

    for (const side of ['ATTACKER', 'DEFENDER'] as const) {
      const sideParticipants = war.participants.filter((p) => p.side === side && p.faction.isActive)
      const sideFactionIds = new Set(sideParticipants.map((p) => p.factionId))

      const candidateIds = new Set<string>()
      for (const p of sideParticipants) {
        const relationships = (p.faction.relationships as any as Record<string, { type: string }>) || {}
        for (const [otherId, rel] of Object.entries(relationships)) {
          if (rel.type === 'ALLY' && !sideFactionIds.has(otherId) && !factionIdsAtWar.has(otherId)) {
            candidateIds.add(otherId)
          }
        }
      }

      if (candidateIds.size === 0) continue

      const candidateFactions = await prisma.faction.findMany({
        where: { id: { in: Array.from(candidateIds) }, campaignId: ctx.campaignId, isActive: true },
        select: { id: true, name: true, military: true },
      })

      let joined = 0
      const remainingCandidates = [...candidateFactions]
      while (joined < MAX_JOINERS_PER_SIDE_PER_TICK) {
        const joiner = decideWarJoiner(remainingCandidates)
        if (!joiner) break

        if (!ctx.dryRun) {
          await prisma.warParticipant.create({
            data: { warId: war.id, factionId: joiner.id, side, joinedTurn: ctx.turnNumber },
          })
        }
        factionIdsAtWar.add(joiner.id)
        joined++

        const primaryOpponentName = side === 'ATTACKER' ? war.defender.name : war.attacker.name
        changes.push({
          entityType: 'FACTION',
          entityId: joiner.id,
          entityName: joiner.name,
          campaignId: ctx.campaignId,
          field: 'warJoined',
          previousValue: 'ally',
          newValue: `at war (${side.toLowerCase()})`,
          reason: `${joiner.name} joins the war against ${primaryOpponentName} in support of its ally`,
          significant: true,
          importance: 'MAJOR',
        })

        const index = remainingCandidates.findIndex((c) => c.id === joiner.id)
        if (index >= 0) remainingCandidates.splice(index, 1)
      }
    }
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
      const createdWar = await prisma.war.create({
        data: {
          campaignId: ctx.campaignId,
          name: prizeLocation ? `War for ${prizeLocation.name}` : `${attacker.name} vs. ${defender.name}`,
          attackerFactionId: attacker.id,
          defenderFactionId: defender.id,
          contestedLocationId: decision.contestedLocationId,
          startedTurn: ctx.turnNumber,
        },
      })
      await prisma.warParticipant.createMany({
        data: [
          { warId: createdWar.id, factionId: attacker.id, side: 'ATTACKER', joinedTurn: ctx.turnNumber },
          { warId: createdWar.id, factionId: defender.id, side: 'DEFENDER', joinedTurn: ctx.turnNumber },
        ],
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
