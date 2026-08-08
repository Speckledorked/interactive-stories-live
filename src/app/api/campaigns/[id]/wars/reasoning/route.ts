// src/app/api/campaigns/[id]/wars/reasoning/route.ts
// #126 — campaign-wide "show your reasoning" for the new admin Wars tab.
// explainWarMomentum (warTick.ts) already existed and was already correct
// — it was only ever exposed nested inside a single faction's reasoning
// preview (factions/[factionId]/reasoning/route.ts). This is the same
// participant-aggregation query, just scoped to every ESCALATING war in
// the campaign instead of one faction's. Read-only: nothing here writes
// anything or advances the turn.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { explainWarMomentum } from '@/lib/game/tick/warTick'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId } = params

    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can preview war reasoning')
    if ('response' in adminCheck) return adminCheck.response

    const worldMeta = await prisma.worldMeta.findUnique({ where: { campaignId }, select: { currentTurnNumber: true } })
    if (!worldMeta) {
      return NextResponse.json({ error: 'Campaign has no world state yet' }, { status: 404 })
    }
    const turnNumber = worldMeta.currentTurnNumber

    const escalatingWars = await prisma.war.findMany({
      where: { campaignId, status: 'ESCALATING' },
      select: {
        id: true, name: true, momentum: true, startedTurn: true,
        attacker: { select: { name: true } },
        defender: { select: { name: true } },
        participants: {
          select: { side: true, faction: { select: { military: true, isActive: true } } },
        },
      },
      orderBy: { startedTurn: 'asc' },
    })

    const wars = escalatingWars.map((war) => {
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
      return {
        warId: war.id,
        name: war.name,
        attackerName: war.attacker.name,
        defenderName: war.defender.name,
        attackerMilitaryTotal,
        defenderMilitaryTotal,
        ...explanation,
      }
    })

    return NextResponse.json({ turnNumber, wars })
  } catch (error) {
    console.error('War reasoning preview error:', error)
    return NextResponse.json({ error: 'Failed to preview war reasoning' }, { status: 500 })
  }
}
