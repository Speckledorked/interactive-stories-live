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

type Db = Prisma.TransactionClient | PrismaClient

export async function loadIntegritySnapshot(
  db: Db,
  campaignId: string,
  turnNumber: number
): Promise<IntegritySnapshot> {
  const [locations, npcs, factions, characters, clocks, debts, wars, quests] = await Promise.all([
    db.location.findMany({ where: { campaignId }, select: { id: true } }),
    db.nPC.findMany({
      where: { campaignId },
      select: { id: true, name: true, isAlive: true, factionId: true, factionRole: true, importance: true, socialTies: true },
    }),
    db.faction.findMany({
      where: { campaignId },
      select: { id: true, name: true, isActive: true, leaderCharacterId: true, relationships: true },
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
  }
}
