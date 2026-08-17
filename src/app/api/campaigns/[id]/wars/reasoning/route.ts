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
import { applyWhatIf, type WhatIfSpec } from '@/lib/api/whatIf'
import { simTurn } from '@/lib/game/turnClock'

/**
 * #427: war what-ifs, scoped to ONE war by `warId`.
 *
 * This route is campaign-wide, so a bare override would silently apply to
 * every war at once — an admin asking about one siege would get four
 * rewritten answers and no signal that three of them were fiction. The
 * `warId` param is what keeps the hypothetical addressable.
 *
 * The military figures are SUMS over each side's active participants, so
 * they are not stat-band values and get their own ceiling. Momentum matches
 * the DB CHECK (`War_momentum_range`, -100..100) rather than a guess — a
 * preview of a momentum the column could never hold is a preview of
 * nothing.
 */
const WAR_WHAT_IF: WhatIfSpec = {
  momentum: { min: -100, max: 100 },
  attackerMilitaryTotal: { min: 0, max: 10_000 },
  defenderMilitaryTotal: { min: 0, max: 10_000 },
}

// #224: a hard backstop, not a tuned precision cap — realistic campaign
// scale (10-20 factions per the app's real tick caps) makes anywhere near
// this many simultaneously ESCALATING wars implausible, but the query had
// no bound at all before this. Generous on purpose, matching #221/#202's
// "backstop, not a tight fit" convention for this session's other
// unbounded-query fixes.
const ESCALATING_WARS_ROW_CAP = 100

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

    // #437: the SIMULATION turn. This panel exists to show what the tick
    // WOULD decide, and every tick decider is called with ctx.turnNumber
    // (the sim clock). Reading the scene counter here meant the preview and
    // the reality diverged on exactly the campaigns where the two clocks
    // had drifted — on the one feature whose entire purpose is showing
    // reality.
    const worldMeta = await prisma.worldMeta.findUnique({ where: { campaignId }, select: { simulationTurn: true } })
    if (!worldMeta) {
      return NextResponse.json({ error: 'Campaign has no world state yet' }, { status: 404 })
    }
    const turnNumber = simTurn(worldMeta.simulationTurn)

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
      take: ESCALATING_WARS_ROW_CAP,
    })

    const whatIfWarId = request.nextUrl.searchParams.get('warId')

    const wars = escalatingWars.map((war) => {
      const attackerSide = war.participants.filter((p) => p.side === 'ATTACKER' && p.faction.isActive)
      const defenderSide = war.participants.filter((p) => p.side === 'DEFENDER' && p.faction.isActive)
      const attackerMilitaryTotal = attackerSide.reduce((sum, p) => sum + p.faction.military, 0)
      const defenderMilitaryTotal = defenderSide.reduce((sum, p) => sum + p.faction.military, 0)

      // Only the war the admin actually named. Every other war on the board
      // keeps its real numbers, so a hypothetical can never be mistaken for
      // a campaign-wide change.
      const targeted = whatIfWarId === war.id
      const projection = targeted
        ? applyWhatIf(
            { momentum: war.momentum, attackerMilitaryTotal, defenderMilitaryTotal },
            request.nextUrl.searchParams,
            WAR_WHAT_IF
          )
        : null

      const explanation = explainWarMomentum(
        { id: war.id, momentum: projection?.snapshot.momentum ?? war.momentum, startedTurn: war.startedTurn },
        war.attacker.name,
        projection?.snapshot.attackerMilitaryTotal ?? attackerMilitaryTotal,
        war.defender.name,
        projection?.snapshot.defenderMilitaryTotal ?? defenderMilitaryTotal,
        turnNumber
      )
      return {
        warId: war.id,
        name: war.name,
        attackerName: war.attacker.name,
        defenderName: war.defender.name,
        attackerMilitaryTotal: projection?.snapshot.attackerMilitaryTotal ?? attackerMilitaryTotal,
        defenderMilitaryTotal: projection?.snapshot.defenderMilitaryTotal ?? defenderMilitaryTotal,
        ...explanation,
        whatIf: {
          overridden: projection?.overridden ?? [],
          rejected: projection?.rejected ?? [],
          actual: { momentum: war.momentum, attackerMilitaryTotal, defenderMilitaryTotal },
        },
      }
    })

    return NextResponse.json({ turnNumber, wars })
  } catch (error) {
    console.error('War reasoning preview error:', error)
    return NextResponse.json({ error: 'Failed to preview war reasoning' }, { status: 500 })
  }
}
