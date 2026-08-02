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
import { findRivalId, parseFactionRelationships } from '@/lib/game/tick/types'
import { parseBeliefVector } from '@/lib/game/tick/beliefTick'

interface FactionForGoalReasoning {
  goal: string
  resources: number
  stability: number
  military: number
  relationships: unknown
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

  const rivalId = findRivalId(parseFactionRelationships(faction.relationships))
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
          relationships: true, beliefVector: true, leaderCharacterId: true,
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

    // A player-led faction's goal is the player's call, not the automatic
    // tick's (see factionTick.ts) — skip the reassessment inputs entirely
    // rather than compute a decision nothing would ever apply.
    const goalReasoning = faction.leaderCharacterId
      ? {
          goal: faction.goal,
          reasoning: ['A player character leads this faction — its goal is their call, not the automatic tick.'],
        }
      : await loadGoalReasoning(campaignId, factionId, faction, turnNumber)

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
      faction: { id: faction.id, name: faction.name, goal: faction.goal },
      turnNumber,
      goalReasoning,
      wars,
    })
  } catch (error) {
    console.error('Faction reasoning preview error:', error)
    return NextResponse.json({ error: 'Failed to preview faction reasoning' }, { status: 500 })
  }
}
