// src/app/api/campaigns/[id]/settings/simulation/route.ts
// World Sim Phase 8 — per-campaign tick caps (see src/lib/game/tick/caps.ts).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { DEFAULT_FACTION_CAP, DEFAULT_NPC_CAP, MAX_FACTION_CAP, MAX_NPC_CAP } from '@/lib/game/tick/caps'
import { DEFAULT_WORLD_TURN_HOURS } from '@/lib/game/tick/pacing'
import { getCampaignMembership, requireCampaignAdmin } from '@/lib/db/campaignAccess'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id

    const membership = await getCampaignMembership(user.userId, campaignId)

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const [worldMeta, campaign] = await Promise.all([
      prisma.worldMeta.findUnique({
        where: { campaignId },
        select: { factionCap: true, npcCap: true, worldTurnHours: true },
      }),
      prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { mapGenerationEnabled: true, sceneImageGenerationEnabled: true },
      }),
    ])

    return NextResponse.json({
      factionCap: worldMeta?.factionCap ?? null,
      npcCap: worldMeta?.npcCap ?? null,
      worldTurnHours: worldMeta?.worldTurnHours ?? null,
      mapGenerationEnabled: campaign?.mapGenerationEnabled ?? false,
      sceneImageGenerationEnabled: campaign?.sceneImageGenerationEnabled ?? false,
      defaultFactionCap: DEFAULT_FACTION_CAP,
      defaultNpcCap: DEFAULT_NPC_CAP,
      defaultWorldTurnHours: DEFAULT_WORLD_TURN_HOURS,
    })
  } catch (error) {
    console.error('Get simulation settings error:', error)
    return NextResponse.json({ error: 'Failed to get simulation settings' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const body = await request.json()

    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can update simulation settings')
    if ('response' in adminCheck) return adminCheck.response

    // Null clears the override back to the default; a positive integer sets
    // a campaign-specific cap. Anything else is rejected rather than
    // silently coerced — a bad cap value would quietly change tick behavior.
    for (const field of ['factionCap', 'npcCap', 'worldTurnHours'] as const) {
      if (body[field] !== null && body[field] !== undefined) {
        if (!Number.isInteger(body[field]) || body[field] < 1) {
          return NextResponse.json(
            { error: `${field} must be a positive integer or null` },
            { status: 400 }
          )
        }
      }
    }

    // #203: factionCap/npcCap specifically (not worldTurnHours, which has
    // no relationship to it) feed every handler's per-tick roster size —
    // raising them far enough risks the real world tick blowing past
    // TICK_TRANSACTION_TIMEOUT_MS, aborting the whole turn. See caps.ts's
    // MAX_FACTION_CAP/MAX_NPC_CAP comment for how that ceiling was chosen.
    if (body.factionCap != null && body.factionCap > MAX_FACTION_CAP) {
      return NextResponse.json(
        { error: `factionCap must be ${MAX_FACTION_CAP} or less` },
        { status: 400 }
      )
    }
    if (body.npcCap != null && body.npcCap > MAX_NPC_CAP) {
      return NextResponse.json(
        { error: `npcCap must be ${MAX_NPC_CAP} or less` },
        { status: 400 }
      )
    }

    // Battle-map generation lives on Campaign, not WorldMeta, but belongs
    // in this same admin surface — it's the same class of per-campaign
    // simulation-cost knob. Boolean-only; anything else is rejected rather
    // than coerced, matching the numeric fields above. Scene illustration
    // (#96) is the same shape, checked the same way.
    if (body.mapGenerationEnabled !== undefined && typeof body.mapGenerationEnabled !== 'boolean') {
      return NextResponse.json(
        { error: 'mapGenerationEnabled must be a boolean' },
        { status: 400 }
      )
    }
    if (body.sceneImageGenerationEnabled !== undefined && typeof body.sceneImageGenerationEnabled !== 'boolean') {
      return NextResponse.json(
        { error: 'sceneImageGenerationEnabled must be a boolean' },
        { status: 400 }
      )
    }

    const campaignUpdateData: { mapGenerationEnabled?: boolean; sceneImageGenerationEnabled?: boolean } = {}
    if (body.mapGenerationEnabled !== undefined) campaignUpdateData.mapGenerationEnabled = body.mapGenerationEnabled
    if (body.sceneImageGenerationEnabled !== undefined) campaignUpdateData.sceneImageGenerationEnabled = body.sceneImageGenerationEnabled

    const updatedCampaign = Object.keys(campaignUpdateData).length === 0
      ? await prisma.campaign.findUnique({
          where: { id: campaignId },
          select: { mapGenerationEnabled: true, sceneImageGenerationEnabled: true },
        })
      : await prisma.campaign.update({
          where: { id: campaignId },
          data: campaignUpdateData,
          select: { mapGenerationEnabled: true, sceneImageGenerationEnabled: true },
        })

    const worldMeta = await prisma.worldMeta.update({
      where: { campaignId },
      data: {
        factionCap: body.factionCap === undefined ? undefined : body.factionCap,
        npcCap: body.npcCap === undefined ? undefined : body.npcCap,
        worldTurnHours: body.worldTurnHours === undefined ? undefined : body.worldTurnHours,
      },
      select: { factionCap: true, npcCap: true, worldTurnHours: true },
    })

    return NextResponse.json({
      factionCap: worldMeta.factionCap,
      npcCap: worldMeta.npcCap,
      worldTurnHours: worldMeta.worldTurnHours,
      mapGenerationEnabled: updatedCampaign?.mapGenerationEnabled ?? false,
      sceneImageGenerationEnabled: updatedCampaign?.sceneImageGenerationEnabled ?? false,
      defaultFactionCap: DEFAULT_FACTION_CAP,
      defaultNpcCap: DEFAULT_NPC_CAP,
      defaultWorldTurnHours: DEFAULT_WORLD_TURN_HOURS,
    })
  } catch (error) {
    console.error('Update simulation settings error:', error)
    return NextResponse.json({ error: 'Failed to update simulation settings' }, { status: 500 })
  }
}
