// src/lib/game/integrity/snapshot.ts
// The only DB-reading step in the Integrity Engine — everything downstream
// (checks, repairs) is pure over the object this returns.
//
// Loads the WHOLE campaign, not the per-turn factionCap/npcCap subset the
// rest of the tick uses: those caps bound how much the simulation ADVANCES
// in one turn, but integrity is asking a different question ("is anything
// in this campaign broken"), and a violation on an NPC outside this turn's
// capped roster is exactly as real as one inside it.

import type { Prisma, PrismaClient } from '@prisma/client'
import { IntegritySnapshot } from './types'
import { parseWorldRules } from './worldRules'

type Db = Prisma.TransactionClient | PrismaClient

export async function loadIntegritySnapshot(
  db: Db,
  campaignId: string,
  turnNumber: number
): Promise<IntegritySnapshot> {
  const [campaign, locations, npcs, factions, characters, clocks, debts, wars, quests, npcTieRows, factionTieRows] = await Promise.all([
    db.campaign.findUnique({ where: { id: campaignId }, select: { worldRules: true } }),
    db.location.findMany({ where: { campaignId }, select: { id: true } }),
    db.nPC.findMany({
      where: { campaignId },
      select: { id: true, name: true, isAlive: true, factionId: true, factionRole: true, importance: true },
    }),
    db.faction.findMany({
      where: { campaignId },
      select: { id: true, name: true, isActive: true, leaderCharacterId: true },
    }),
    db.character.findMany({
      where: { campaignId },
      select: { id: true, name: true, relationships: true, resources: true },
    }),
    db.clock.findMany({
      where: { campaignId },
      select: { id: true, name: true, resolvedAt: true, sourceFactionId: true, participantNpcIds: true },
    }),
    db.debt.findMany({
      where: { campaignId },
      select: { id: true, counterpartyId: true, counterpartyName: true, counterpartyType: true },
    }),
    db.war.findMany({
      where: { campaignId },
      select: { id: true, name: true, status: true, contestedLocationId: true },
    }),
    db.quest.findMany({ where: { campaignId }, select: { id: true, name: true } }),
    // #373: the tie edges themselves. Loaded uncapped like everything else
    // here — an orphaned or wrongly-ordered edge between two NPCs outside
    // this turn's roster is exactly as real as one inside it.
    db.npcTie.findMany({
      where: { campaignId },
      select: { npcAId: true, npcBId: true, type: true, since: true },
    }),
    db.factionTie.findMany({
      where: { campaignId },
      select: { factionAId: true, factionBId: true, type: true, since: true },
    }),
  ])

  return {
    campaignId,
    turnNumber,
    locationIds: new Set(locations.map((l) => l.id)),
    npcs,
    factions,
    characters,
    clocks,
    debts,
    wars,
    quests,
    npcTies: npcTieRows.map((r) => ({ aId: r.npcAId, bId: r.npcBId, type: r.type, since: r.since })),
    factionTies: factionTieRows.map((r) => ({ aId: r.factionAId, bId: r.factionBId, type: r.type, since: r.since })),
    worldRules: parseWorldRules(campaign?.worldRules),
  }
}
