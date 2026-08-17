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
import { persistWorldEvents } from './worldEventLog'
import { SEASON_MODIFIERS } from './seasonTick'
import { GeneratedCalendar, deriveSeason } from '../calendar'
import { simTurn, type SimTurn } from '@/lib/game/turnClock'

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
export interface ClockAdvancementExplanation {
  advanceAmount: number
  /** Human-readable trace of which driver branch fired — #126, same shape
   * as FactionGoalExplanation/ConditionDriftExplanation. */
  reasoning: string[]
}

/**
 * Pure — the full clock-advancement decision, WITH the reasoning trace.
 * decideClockAdvancement below is a thin wrapper over this; the two can
 * never drift apart because there's only one implementation.
 */
export function explainClockAdvancement(
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
  tension: number = TENSION_BASELINE,
  // #118: only consulted for the same unattached-GM-clock branch tension
  // is — a driven clock's pace is a statement about its actor's strength,
  // not the season. 1 = neutral (spring/summer baseline); scales the
  // category-based roll THRESHOLD (not the returned tick count directly,
  // which must stay an integer 0/1/2) so a season can only ever nudge the
  // probability of ticking this turn, never push a clock past its
  // existing one-tick-per-turn cap on its own.
  clockSpeedMultiplier: number = 1
): ClockAdvancementExplanation {
  const roll = (salt: string) => stableHash(`${clock.id}:${turnNumber}:${salt}`) % 100

  // A faction's own tracked ambition: paced by how strong the faction
  // pursuing it actually is, not chance — a well-resourced, well-armed
  // faction executes its plans faster than one scraping by. A faction that
  // collapsed before the ambition resolved stalls it dead rather than
  // ticking on toward a resolution nobody is left to claim.
  if (clock.sourceFactionId) {
    const faction = factionById.get(clock.sourceFactionId)
    if (!faction?.isActive) {
      return { advanceAmount: 0, reasoning: ['This is the tracked ambition of a faction that is no longer active — stalled dead, nobody left to advance it.'] }
    }
    const strength = band((faction.resources + faction.military) / 2)
    const advanceAmount = strength === 'HIGH' ? 2 : strength === 'MEDIUM' ? 1 : 0
    return {
      advanceAmount,
      reasoning: [`This is the tracked ambition of a faction whose combined resources/military strength is ${strength} — advances ${advanceAmount} tick(s) this turn.`],
    }
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
    const advanceAmount = roll('related') < threshold ? 1 : 0
    const instabilityNote = faction?.isActive
      ? `its linked faction's instability is ${instability}`
      : "its linked faction is inactive/unlinked, so instability defaults to MEDIUM"
    return {
      advanceAmount,
      reasoning: [`This is a front tied to a faction (not its own ambition) — ${instabilityNote}, giving a ${threshold}% chance to advance this turn. ${advanceAmount > 0 ? 'It advanced.' : 'It did not advance.'}`],
    }
  }

  // A joint NPC scheme: two committed conspirators make steady progress
  // every turn they're both still in it — no faction backing to modulate.
  if (clock.participantNpcIds.length > 0) {
    return { advanceAmount: 1, reasoning: ['This is a joint NPC scheme — committed conspirators make steady, guaranteed progress every turn, no faction backing to modulate it.'] }
  }

  // No faction/NPC driver at all — a GM-authored clock. Category is the
  // primary signal (deterministic via stableHash, not Math.random), and
  // dramatic tension nudges it: at a breaking point, unattached threats
  // close faster. The bonus is capped at +1 and can't push a clock past
  // one tick per turn on its own, so a tense campaign accelerates rather
  // than runs away.
  const tensionBonus = tensionClockBonus(tension)
  // 'urgent' clocks always tick every turn regardless of season — there's
  // no discretionary component left to modulate without breaking that
  // guarantee.
  if (clock.category === 'urgent') {
    return { advanceAmount: 1, reasoning: ["This is an 'urgent' unattached clock — always advances every turn, regardless of season or tension."] }
  }
  const threshold = (clock.category === 'slow' ? 20 : 40) * clockSpeedMultiplier
  const rolled = roll('category')
  const advanceAmount = rolled < threshold ? 1 : Math.min(tensionBonus, 1)
  return {
    advanceAmount,
    reasoning: [
      `This is an unattached, category-paced clock ('${clock.category ?? 'default'}') — ${threshold.toFixed(0)}% roll threshold this turn (season-adjusted), tension bonus up to ${Math.min(tensionBonus, 1)}.`,
      rolled < threshold
        ? 'The category roll succeeded — it advances 1 tick.'
        : tensionBonus > 0
          ? `The category roll missed, but dramatic tension (${tension}) grants a fallback advance.`
          : 'The category roll missed and tension is not high enough to grant a fallback advance — it holds this turn.',
    ],
  }
}

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
  tension: number = TENSION_BASELINE,
  clockSpeedMultiplier: number = 1
): number {
  return explainClockAdvancement(clock, factionById, turnNumber, tension, clockSpeedMultiplier).advanceAmount
}

/**
 * Advance clocks based on what's actually driving them: a faction's
 * strength for its own ambitions, a linked faction's stability for fronts,
 * steady progress for joint NPC schemes, and category pacing only as a
 * last resort for clocks with no such link. See decideClockAdvancement.
 */
export async function advanceClocks(campaignId: string, simulationTurn?: SimTurn) {
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
    select: {
      simulationTurn: true,
      totalElapsedGameHours: true,
      campaign: { select: { calendarConfig: true } },
    },
  })

  // #374, one function further out than the original fix reached.
  //
  // This read `currentTurnNumber` — the SCENE counter — and every use of
  // turnNumber below is a simulation concern: the stableHash roll that
  // paces unattached clocks, the tension refresh, and (now) the turn each
  // clock event is stamped with. On an idle campaign the scene counter
  // never moves, so `stableHash(clock.id:turnNumber:salt)` was CONSTANT:
  // every category-paced clock either advanced every single turn forever
  // or never advanced at all, decided once by its id. The urgent and
  // faction-driven branches hid it, because neither consults the roll.
  //
  // runWorldTurn already computes the real value (simulationTurn + 1) and
  // passes it to runWorldTick; it passes it here too now. The fallback
  // read exists for the admin/force paths that call advanceClocks
  // directly, and reads the simulation clock rather than the scene one.
  const turnNumber = simulationTurn ?? simTurn(worldMeta?.simulationTurn ?? 0)

  // #118: unattached-GM-clock speed. Computed here (not passed in) since
  // advanceClocks runs outside TICK_HANDLERS — this is the only place that
  // both loads the calendar and calls decideClockAdvancement.
  const calendar = worldMeta?.campaign?.calendarConfig
    ? (worldMeta.campaign.calendarConfig as unknown as GeneratedCalendar)
    : null
  const season = deriveSeason(worldMeta?.totalElapsedGameHours ?? 0, calendar)
  const clockSpeedMultiplier = SEASON_MODIFIERS[season].clockSpeedMultiplier

  const tension = await refreshCampaignTension(campaignId, turnNumber, clocks)

  const advancedClocks: any[] = []
  const clockUpdates: Array<{ clock: (typeof clocks)[number]; newTicks: number }> = []

  for (const clock of clocks) {
    const advanceAmount = decideClockAdvancement(clock, factionById, turnNumber, tension, clockSpeedMultiplier)

    if (advanceAmount > 0) {
      const newTicks = Math.min(clock.currentTicks + advanceAmount, clock.maxTicks)
      clockUpdates.push({ clock, newTicks })
    }
  }

  // #229: every clock write for this turn commits together or not at all.
  // advanceClocks runs after runWorldTick's own $transaction has already
  // committed (see worldTurn.ts), so this is deliberately a separate
  // transaction, not an extension of that one — but a mid-loop failure
  // used to leave some clocks advanced and others not, with the rest of
  // this turn's world state already durable. Wrapping just the writes
  // (not the pure decision loop above) closes that partial-failure window
  // for clock advancement itself.
  if (clockUpdates.length > 0) {
    await prisma.$transaction(
      clockUpdates.map(({ clock, newTicks }) =>
        prisma.clock.update({ where: { id: clock.id }, data: { currentTicks: newTicks } })
      )
    )
  }

  for (const { clock, newTicks } of clockUpdates) {
    console.log(`  ⏰ ${clock.name}: ${clock.currentTicks} → ${newTicks}`)
    advancedClocks.push({
      id: clock.id,
      name: clock.name,
      oldTicks: clock.currentTicks,
      newTicks,
      category: clock.category
    })
  }

  // #396: a clock advancing is a change to the world and left NO durable
  // record of itself. `Clock.currentTicks` was overwritten in place, the
  // return value above lives only for the rest of this function's caller,
  // and the only WorldEvent rows with targetType CLOCK came from clock
  // RESOLUTION (clockResolutionEffects.ts) or an integrity repair.
  //
  // So a countdown that moved from 1/6 to 5/6 across a player's absence —
  // the single most tension-carrying thing the simulation does offscreen —
  // was unreconstructible from any surface, because nothing had written it
  // down. The absence journal reads WorldEvent; this is the writer it was
  // missing. Same omission shape as #395, one layer earlier: there the
  // reader filtered out types that could never appear, here the type never
  // appeared at all.
  //
  // Written through persistWorldEvents like every other change, so it picks
  // up the #377 dedupe key and stays a no-op on a replayed turn.
  if (clockUpdates.length > 0) {
    await persistWorldEvents(
      campaignId,
      turnNumber,
      clockUpdates.map(({ clock, newTicks }) => ({
        entityType: 'CLOCK' as const,
        entityId: clock.id,
        entityName: clock.name,
        campaignId,
        field: 'currentTicks',
        previousValue: clock.currentTicks,
        newValue: newTicks,
        reason: `${clock.name} advances to ${newTicks}/${clock.maxTicks}`,
        // A clock reaching its last tick is the beat worth surfacing; the
        // steps toward it are texture, same tier as weather severity.
        significant: newTicks >= clock.maxTicks,
        importance: (newTicks >= clock.maxTicks ? 'MAJOR' : 'NORMAL') as 'MAJOR' | 'NORMAL',
      }))
    )
  }

  console.log(`  Advanced ${advancedClocks.length} clock(s)`)
  return advancedClocks
}
