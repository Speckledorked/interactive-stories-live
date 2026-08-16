// src/app/api/campaigns/[id]/factions/[factionId]/reasoning/route.ts
// #94 — "show your reasoning" for the faction admin tab, the same pattern
// the tick dry-run preview already established for the whole simulation
// (world-tick/preview/route.ts), scoped to one faction. Read-only: loads
// this faction's real current state and projects its next goal
// reassessment (and, if it's fighting, its next war-momentum push) using
// the exact same pure decide/explain functions the real tick calls —
// nothing here writes anything or advances the turn.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { explainFactionGoalReassessment } from '@/lib/game/tick/factionTick'
import { explainWarMomentum } from '@/lib/game/tick/warTick'
import { findRivalId } from '@/lib/game/tick/types'
import { TIE_INCLUDE, factionTies, type FactionTieRow } from '@/lib/game/tieGraph'
import { parseBeliefVector } from '@/lib/game/tick/beliefTick'
import { applyWhatIf, STAT_BAND, type WhatIfSpec } from '@/lib/api/whatIf'

/**
 * #427: the stats an admin may perturb to ask "what would this faction do
 * if…". Exactly the three `decideFactionGoalReassessment` reads — opening
 * a field the decision never consults would render a control that changes
 * nothing, which teaches the reader the preview is decorative.
 */
const FACTION_WHAT_IF: WhatIfSpec = {
  resources: STAT_BAND,
  stability: STAT_BAND,
  military: STAT_BAND,
}

interface FactionForGoalReasoning {
  goal: string
  resources: number
  stability: number
  military: number
  id: string
  tiesAsA?: FactionTieRow[] | null
  tiesAsB?: FactionTieRow[] | null
  beliefVector: unknown
}

/** Loads the two real-state reads decideFactionGoalReassessment's caller
 * (factionTick.ts) already does — goal-commitment history and rival
 * liveness — then calls the same pure explain function a real tick would. */
async function loadGoalReasoning(campaignId: string, factionId: string, faction: FactionForGoalReasoning, turnNumber: number) {
  const lastGoalChange = await prisma.worldEvent.findFirst({
    where: { campaignId, type: 'faction.goal', targetId: factionId },
    orderBy: { turnNumber: 'desc' },
    select: { turnNumber: true },
  })
  const turnsOnCurrentGoal = lastGoalChange ? turnNumber - lastGoalChange.turnNumber : undefined

  const rivalId = findRivalId(factionTies(faction))
  const rival = rivalId ? await prisma.faction.findUnique({ where: { id: rivalId }, select: { isActive: true } }) : null
  const hasRival = !!rival?.isActive

  return explainFactionGoalReassessment({
    resources: faction.resources,
    stability: faction.stability,
    military: faction.military,
    goal: faction.goal as any,
    hasRival,
    turnsOnCurrentGoal,
    beliefVector: parseBeliefVector(faction.beliefVector),
  })
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; factionId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, factionId } = params

    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can preview faction reasoning')
    if ('response' in adminCheck) return adminCheck.response

    const [faction, worldMeta] = await Promise.all([
      prisma.faction.findFirst({
        where: { id: factionId, campaignId },
        select: {
          id: true, name: true, goal: true, resources: true, stability: true, military: true,
          beliefVector: true, leaderCharacterId: true, ...TIE_INCLUDE,
        },
      }),
      prisma.worldMeta.findUnique({ where: { campaignId }, select: { currentTurnNumber: true } }),
    ])

    if (!faction) {
      return NextResponse.json({ error: 'Faction not found' }, { status: 404 })
    }
    if (!worldMeta) {
      return NextResponse.json({ error: 'Campaign has no world state yet' }, { status: 404 })
    }

    const turnNumber = worldMeta.currentTurnNumber

    // #427: overlay the what-if BEFORE any reasoning runs, so every
    // downstream projection sees one consistent hypothetical rather than a
    // mix of real and imagined state. Nothing below writes, and this route
    // is a GET, so the hypothetical cannot escape the response.
    const whatIf = applyWhatIf(faction, request.nextUrl.searchParams, FACTION_WHAT_IF)
    const projected = whatIf.snapshot

    // A player-led faction's goal is the player's call, not the automatic
    // tick's (see factionTick.ts) — skip the reassessment inputs entirely
    // rather than compute a decision nothing would ever apply.
    const goalReasoning = projected.leaderCharacterId
      ? {
          goal: projected.goal,
          reasoning: ['A player character leads this faction — its goal is their call, not the automatic tick.'],
        }
      : await loadGoalReasoning(campaignId, factionId, projected, turnNumber)

    // Any war (as the original declarer or an ally pulled in later) this
    // faction is currently fighting — same participant aggregation
    // resolveWarProgress (warTick.ts) uses for real, so the projected
    // momentum here matches what the next real tick would actually do.
    const participations = await prisma.warParticipant.findMany({
      where: { factionId, war: { status: 'ESCALATING' } },
      select: {
        side: true,
        war: {
          select: {
            id: true, name: true, momentum: true, startedTurn: true,
            attacker: { select: { name: true } },
            defender: { select: { name: true } },
            participants: {
              select: { side: true, faction: { select: { military: true, isActive: true } } },
            },
          },
        },
      },
    })

    const wars = participations.map(({ war }) => {
      const attackerSide = war.participants.filter((p) => p.side === 'ATTACKER' && p.faction.isActive)
      const defenderSide = war.participants.filter((p) => p.side === 'DEFENDER' && p.faction.isActive)
      const attackerMilitaryTotal = attackerSide.reduce((sum, p) => sum + p.faction.military, 0)
      const defenderMilitaryTotal = defenderSide.reduce((sum, p) => sum + p.faction.military, 0)
      const explanation = explainWarMomentum(
        { id: war.id, momentum: war.momentum, startedTurn: war.startedTurn },
        war.attacker.name,
        attackerMilitaryTotal,
        war.defender.name,
        defenderMilitaryTotal,
        turnNumber
      )
      return { warId: war.id, name: war.name, attackerName: war.attacker.name, defenderName: war.defender.name, ...explanation }
    })

    return NextResponse.json({
      faction: { id: faction.id, name: faction.name, goal: projected.goal },
      turnNumber,
      goalReasoning,
      wars,
      // Always present, so a client can render the what-if state without
      // having to infer it from whether it sent params.
      whatIf: {
        overridden: whatIf.overridden,
        rejected: whatIf.rejected,
        // The real values, so the UI can show what was replaced rather than
        // making the admin remember.
        actual: { resources: faction.resources, stability: faction.stability, military: faction.military },
      },
    })
  } catch (error) {
    console.error('Faction reasoning preview error:', error)
    return NextResponse.json({ error: 'Failed to preview faction reasoning' }, { status: 500 })
  }
}
