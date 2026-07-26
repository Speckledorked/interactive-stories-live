// src/lib/game/tick/clockTick.ts
// Clock advancement: how many ticks a GM-authored, faction-ambition, or
// joint-NPC-scheme Clock advances this world turn.
//
// Not one of the handlers in worldTick.ts's TICK_HANDLERS list — clocks
// advance once per world turn (see worldTurn.ts's runWorldTurn), not once
// per deterministic tick pass — but the same shape as everything else in
// this directory: a pure `decide*` function plus the DB-touching handler
// that applies it.

import { prisma } from '@/lib/prisma'
import { band } from './factionTick'
import { stableHash } from './types'
import { TENSION_BASELINE, tensionClockBonus, refreshCampaignTension } from './tension'

export interface FactionForClockAdvancement {
  resources: number
  military: number
  stability: number
  isActive: boolean
}

/**
 * How many ticks a clock advances this turn. Deterministic given
 * (clock, faction snapshot, turn number) — no Math.random anywhere, so a
 * dry-run preview and a real turn agree, and this is unit-testable without
 * a database. Driven by whichever real linkage the clock actually has (see
 * the Clock model's sourceFactionId/relatedFactionId/participantNpcIds doc
 * comments in schema.prisma), falling back to category-based pacing only
 * for a clock with no faction/NPC driver at all.
 */
export function decideClockAdvancement(
  clock: {
    id: string
    category: string | null
    sourceFactionId: string | null
    relatedFactionId: string | null
    participantNpcIds: string[]
  },
  factionById: Map<string, FactionForClockAdvancement>,
  turnNumber: number,
  // Current dramatic tension (see tick/tension.ts). Only consulted for
  // clocks with no faction/NPC driver — a driven clock's pace is a
  // statement about that actor's strength, and folding mood into it too
  // would double-count.
  tension: number = TENSION_BASELINE
): number {
  const roll = (salt: string) => stableHash(`${clock.id}:${turnNumber}:${salt}`) % 100

  // A faction's own tracked ambition: paced by how strong the faction
  // pursuing it actually is, not chance — a well-resourced, well-armed
  // faction executes its plans faster than one scraping by. A faction that
  // collapsed before the ambition resolved stalls it dead rather than
  // ticking on toward a resolution nobody is left to claim.
  if (clock.sourceFactionId) {
    const faction = factionById.get(clock.sourceFactionId)
    if (!faction?.isActive) return 0
    const strength = band((faction.resources + faction.military) / 2)
    return strength === 'HIGH' ? 2 : strength === 'MEDIUM' ? 1 : 0
  }

  // A front informationally tied to a faction (not its own tracked
  // ambition — see relatedFactionId's doc comment): an unstable faction
  // pushes its schemes harder than a calm one, but nothing here is ever
  // fully static, and an inactive/unlinked faction defaults to a middling
  // pace rather than freezing the front entirely.
  if (clock.relatedFactionId) {
    const faction = factionById.get(clock.relatedFactionId)
    const instability = faction?.isActive ? band(100 - faction.stability) : 'MEDIUM'
    const threshold = instability === 'HIGH' ? 65 : instability === 'MEDIUM' ? 40 : 20
    return roll('related') < threshold ? 1 : 0
  }

  // A joint NPC scheme: two committed conspirators make steady progress
  // every turn they're both still in it — no faction backing to modulate.
  if (clock.participantNpcIds.length > 0) return 1

  // No faction/NPC driver at all — a GM-authored clock. Category is the
  // primary signal (deterministic via stableHash, not Math.random), and
  // dramatic tension nudges it: at a breaking point, unattached threats
  // close faster. The bonus is capped at +1 and can't push a clock past
  // one tick per turn on its own, so a tense campaign accelerates rather
  // than runs away.
  const tensionBonus = tensionClockBonus(tension)
  if (clock.category === 'urgent') return 1
  if (clock.category === 'slow') return roll('category') < 20 ? 1 : Math.min(tensionBonus, 1)
  return roll('category') < 40 ? 1 : Math.min(tensionBonus, 1)
}

/**
 * Advance clocks based on what's actually driving them: a faction's
 * strength for its own ambitions, a linked faction's stability for fronts,
 * steady progress for joint NPC schemes, and category pacing only as a
 * last resort for clocks with no such link. See decideClockAdvancement.
 */
export async function advanceClocks(campaignId: string) {
  console.log('  Fetching active clocks...')

  const clocks = await prisma.clock.findMany({
    where: {
      campaignId,
      currentTicks: { lt: prisma.clock.fields.maxTicks } // Not completed
    }
  })

  const factionIds = new Set<string>()
  for (const c of clocks) {
    if (c.sourceFactionId) factionIds.add(c.sourceFactionId)
    if (c.relatedFactionId) factionIds.add(c.relatedFactionId)
  }
  const factions = factionIds.size > 0
    ? await prisma.faction.findMany({
        where: { id: { in: Array.from(factionIds) } },
        select: { id: true, resources: true, military: true, stability: true, isActive: true },
      })
    : []
  const factionById = new Map(factions.map(f => [f.id, f]))

  const worldMeta = await prisma.worldMeta.findUnique({
    where: { campaignId },
    select: { currentTurnNumber: true },
  })
  const turnNumber = worldMeta?.currentTurnNumber ?? 0

  const tension = await refreshCampaignTension(campaignId, turnNumber, clocks)

  const advancedClocks: any[] = []

  for (const clock of clocks) {
    const advanceAmount = decideClockAdvancement(clock, factionById, turnNumber, tension)

    if (advanceAmount > 0) {
      const newTicks = Math.min(clock.currentTicks + advanceAmount, clock.maxTicks)

      await prisma.clock.update({
        where: { id: clock.id },
        data: { currentTicks: newTicks }
      })

      console.log(`  ⏰ ${clock.name}: ${clock.currentTicks} → ${newTicks}`)

      advancedClocks.push({
        id: clock.id,
        name: clock.name,
        oldTicks: clock.currentTicks,
        newTicks,
        category: clock.category
      })
    }
  }

  console.log(`  Advanced ${advancedClocks.length} clock(s)`)
  return advancedClocks
}
