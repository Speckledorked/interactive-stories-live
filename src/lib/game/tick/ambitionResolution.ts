// src/lib/game/tick/ambitionResolution.ts
// Resolve completed ambition clocks (see ambitionTick.ts) into a real
// faction outcome — win or lose, deterministically — instead of the generic
// flavor-text completion event checkAndResolveCompletedClocks would
// otherwise produce for them. Called from worldTurn.ts's runWorldTurn
// before offscreen event generation, so the world summary the AI sees
// already reflects the real outcome.

import { prisma } from '@/lib/prisma'
import { WorldChange, clamp, findRivalIds } from './types'
import { decideAmbitionOutcome } from './ambitionTick'
import { decideTerritoryClaim } from './territory'
import { persistWorldEvents } from './worldEventLog'
import { logSignificantChanges } from './historyLog'

export async function resolveCompletedAmbitions(
  campaignId: string,
  currentTurn: number,
  completedAmbitionClocks: any[],
  inGameDayNumber?: number
) {
  const changes: WorldChange[] = []

  for (const clock of completedAmbitionClocks) {
    const faction = await prisma.faction.findUnique({ where: { id: clock.sourceFactionId! } })
    // A faction that collapsed before its ambition resolved is no longer
    // around to receive the outcome — nothing to apply it to.
    if (!faction || !faction.isActive) continue

    const target = clock.targetFactionId
      ? await prisma.faction.findUnique({ where: { id: clock.targetFactionId } })
      : null

    const outcome = decideAmbitionOutcome({
      factionId: faction.id,
      clockId: clock.id,
      factionName: faction.name,
      goal: faction.goal,
      resources: faction.resources,
      military: faction.military,
      targetFactionName: target?.isActive ? target.name : undefined,
    })

    const newResources = clamp(faction.resources + outcome.resourceDelta, 0, 100)
    const newStability = clamp(faction.stability + outcome.stabilityDelta, 0, 100)
    const newMilitary = clamp(faction.military + outcome.militaryDelta, 0, 100)
    const newThreatLevel = clamp(faction.threatLevel + outcome.threatLevelDelta, 1, 5)

    await prisma.faction.update({
      where: { id: faction.id },
      data: {
        resources: newResources,
        stability: newStability,
        military: newMilitary,
        threatLevel: newThreatLevel,
      },
    })

    // Apply the other side of a successful DESTABILIZE_RIVAL — the named
    // rival actually takes the damage, not just a line in the acting
    // faction's flavor text.
    if (target?.isActive && (outcome.targetStabilityDelta !== 0 || outcome.targetResourceDelta !== 0)) {
      const targetNewStability = clamp(target.stability + outcome.targetStabilityDelta, 0, 100)
      const targetNewResources = clamp(target.resources + outcome.targetResourceDelta, 0, 100)

      await prisma.faction.update({
        where: { id: target.id },
        data: { stability: targetNewStability, resources: targetNewResources },
      })

      changes.push({
        entityType: 'FACTION',
        entityId: target.id,
        entityName: target.name,
        campaignId,
        field: 'ambitionTargeted',
        previousValue: 'stable',
        newValue: 'undermined',
        reason: `${target.name} was undermined by ${faction.name}'s scheme, weakening its stability and resources`,
        significant: true,
        importance: 'NORMAL',
      })

      // A successful scheme also puts one of the rival's holdings in play —
      // the foothold that lets a later EXPAND conquer it (see territory.ts).
      const targetHolding = await prisma.location.findFirst({
        where: { campaignId, ownerFactionId: target.id, isContested: false },
        orderBy: { name: 'asc' },
      })
      if (targetHolding) {
        await prisma.location.update({ where: { id: targetHolding.id }, data: { isContested: true } })
        changes.push({
          entityType: 'FACTION',
          entityId: target.id,
          entityName: target.name,
          campaignId,
          field: 'territoryContested',
          previousValue: targetHolding.name,
          newValue: `${targetHolding.name} (contested)`,
          reason: `${faction.name}'s scheme has destabilized ${target.name}'s hold on ${targetHolding.name}`,
          significant: true,
          importance: 'MAJOR',
        })
      }
    }

    // A successful EXPAND redraws the actual map: conquer contested rival
    // land, settle unowned land, or contest a rival holding — in that
    // escalation order (see territory.ts for why conquest takes two wins).
    if (outcome.success && faction.goal === 'EXPAND') {
      const [locations, rivalIds] = [
        await prisma.location.findMany({
          where: { campaignId },
          select: { id: true, name: true, ownerFactionId: true, isContested: true },
        }),
        findRivalIds(faction.relationships),
      ]

      const claim = decideTerritoryClaim(locations, faction.id, rivalIds)

      if (claim.kind === 'conquer' || claim.kind === 'settle') {
        await prisma.location.update({
          where: { id: claim.locationId },
          data: { ownerFactionId: faction.id, isContested: false },
        })
      } else if (claim.kind === 'contest') {
        await prisma.location.update({
          where: { id: claim.locationId },
          data: { isContested: true },
        })
      }

      if (claim.kind !== 'none') {
        const reasonByKind = {
          conquer: `${faction.name} seizes ${claim.locationName}, taking it from its former masters`,
          settle: `${faction.name} claims ${claim.locationName}, bringing it under its banner`,
          contest: `${faction.name} moves against ${claim.locationName}, contesting its rival's hold on it`,
        } as const
        changes.push({
          entityType: 'FACTION',
          entityId: faction.id,
          entityName: faction.name,
          campaignId,
          field: claim.kind === 'contest' ? 'territoryContested' : 'territoryClaimed',
          previousValue: '(none)',
          newValue: claim.locationName,
          reason: reasonByKind[claim.kind],
          significant: true,
          importance: 'MAJOR',
        })
        console.log(`  🗺️ ${reasonByKind[claim.kind]}`)
      }
    }

    await prisma.timelineEvent.create({
      data: {
        campaignId,
        turnNumber: currentTurn,
        title: `${clock.name} - ${outcome.success ? 'Complete!' : 'Failed'}`,
        summaryPublic: outcome.consequenceText,
        summaryGM: `${outcome.consequenceText} (Δresources ${outcome.resourceDelta >= 0 ? '+' : ''}${outcome.resourceDelta}, Δstability ${outcome.stabilityDelta >= 0 ? '+' : ''}${outcome.stabilityDelta}, Δmilitary ${outcome.militaryDelta >= 0 ? '+' : ''}${outcome.militaryDelta})`,
        isOffscreen: true,
        visibility: clock.isHidden ? 'GM_ONLY' : 'PUBLIC',
        inGameDayNumber,
      },
    })

    changes.push({
      entityType: 'FACTION',
      entityId: faction.id,
      entityName: faction.name,
      campaignId,
      field: 'ambitionResolved',
      previousValue: 'pending',
      newValue: outcome.success ? 'succeeded' : 'failed',
      reason: outcome.consequenceText,
      significant: true,
      importance: 'MAJOR',
    })

    console.log(`  🎯 ${faction.name}'s ambition ${outcome.success ? 'succeeded' : 'failed'}: ${outcome.consequenceText}`)
  }

  if (changes.length > 0) {
    await persistWorldEvents(campaignId, currentTurn, changes)
    await logSignificantChanges(campaignId, currentTurn, changes)
  }
}
