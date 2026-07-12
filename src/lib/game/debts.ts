// src/lib/game/debts.ts
// Urban Shadows Debt economy: owed favors between player characters and
// NPCs/factions, in either direction. Debts are the AI GM's currency for
// consequences and leverage — incurred when the fiction earns them,
// called in later as pressure, resolved when honored or refused.
//
// Presentation philosophy (same as capabilities): mechanical rows under
// the hood, diegetic language on every surface. The sheet says "Lord
// Kessler considers you in his debt", never "Debts: 2".

import { Prisma, DebtDirection } from '@prisma/client'

export interface DebtChange {
  counterparty_name: string
  counterparty_type: 'npc' | 'faction'
  direction: 'owed_by_character' | 'owed_to_character'
  action: 'incur' | 'resolve'
  description: string // incur: what the favor was; resolve: how it ended
  reason: string
}

const DIRECTION_MAP: Record<DebtChange['direction'], DebtDirection> = {
  owed_by_character: 'OWED_BY_CHARACTER',
  owed_to_character: 'OWED_TO_CHARACTER',
}

type Db = Prisma.TransactionClient

/**
 * The single writer for the Debt economy.
 *
 *  incur   — a new favor is owed. Tries to resolve the counterparty to a
 *            known NPC/faction id (name match, same pattern as the rest
 *            of the AI pipeline); an unknown name still creates the debt
 *            with the name denormalized — social reality doesn't wait
 *            for the wiki.
 *  resolve — an existing outstanding debt with that counterparty (and
 *            direction) ends: honored, refused, forgiven. Oldest first.
 *            No matching open debt = skip silently (the AI sometimes
 *            narrates settling a debt it never formally incurred).
 *
 * Returns human-readable log lines for the resolution summary.
 */
export async function applyDebtChanges(
  db: Db,
  campaignId: string,
  characterId: string,
  characterName: string,
  changes: DebtChange[],
  currentTurn: number
): Promise<string[]> {
  const log: string[] = []

  for (const change of changes) {
    const name = change.counterparty_name?.trim()
    if (!name || !change.description) continue
    const direction = DIRECTION_MAP[change.direction]
    if (!direction) continue

    if (change.action === 'incur') {
      // Best-effort entity resolution — never blocks debt creation.
      let counterpartyId: string | null = null
      try {
        if (change.counterparty_type === 'faction') {
          const faction = await db.faction.findFirst({
            where: { campaignId, name: { equals: name, mode: 'insensitive' } },
            select: { id: true },
          })
          counterpartyId = faction?.id || null
        } else {
          const npc = await db.nPC.findFirst({
            where: { campaignId, name: { equals: name, mode: 'insensitive' } },
            select: { id: true },
          })
          counterpartyId = npc?.id || null
        }
      } catch {
        counterpartyId = null
      }

      // Idempotence guard: an identical open debt (same counterparty,
      // direction, description) doesn't stack — the AI occasionally
      // re-reports the same favor across consecutive exchanges.
      const duplicate = await db.debt.findFirst({
        where: {
          characterId,
          status: 'OUTSTANDING',
          direction,
          counterpartyName: { equals: name, mode: 'insensitive' },
          description: change.description,
        },
      })
      if (duplicate) continue

      await db.debt.create({
        data: {
          campaignId,
          characterId,
          direction,
          counterpartyType: change.counterparty_type,
          counterpartyId,
          counterpartyName: name,
          description: change.description,
          turnCreated: currentTurn,
        },
      })
      log.push(
        direction === 'OWED_BY_CHARACTER'
          ? `${characterName} now owes ${name}: ${change.description}`
          : `${name} now owes ${characterName}: ${change.description}`
      )
      continue
    }

    // resolve
    const open = await db.debt.findFirst({
      where: {
        characterId,
        status: 'OUTSTANDING',
        direction,
        counterpartyName: { equals: name, mode: 'insensitive' },
      },
      orderBy: { createdAt: 'asc' },
    })
    if (!open) {
      console.warn(`  ❓ debt_changes: no open debt ${change.direction} with "${name}" to resolve — skipped`)
      continue
    }
    await db.debt.update({
      where: { id: open.id },
      data: {
        status: 'RESOLVED',
        resolution: change.description,
        turnResolved: currentTurn,
        resolvedAt: new Date(),
      },
    })
    log.push(`Debt settled with ${name}: ${change.description}`)
  }

  return log
}

// ---------------------------------------------------------------------------
// Read-side shaping (prompt + sheet share the same diegetic language)
// ---------------------------------------------------------------------------

export interface DebtRowForDisplay {
  direction: DebtDirection
  counterpartyName: string
  description: string
}

export interface DebtSummary {
  owedByCharacter: Array<{ counterparty: string; description: string }>
  owedToCharacter: Array<{ counterparty: string; description: string }>
}

export function summarizeDebts(rows: DebtRowForDisplay[]): DebtSummary {
  return {
    owedByCharacter: rows
      .filter(r => r.direction === 'OWED_BY_CHARACTER')
      .map(r => ({ counterparty: r.counterpartyName, description: r.description })),
    owedToCharacter: rows
      .filter(r => r.direction === 'OWED_TO_CHARACTER')
      .map(r => ({ counterparty: r.counterpartyName, description: r.description })),
  }
}

/** One diegetic line per debt for the AI prompt's character block. */
export function formatDebtsForPrompt(summary: DebtSummary, characterName: string): string[] {
  return [
    ...summary.owedByCharacter.map(d => `${characterName} owes ${d.counterparty} (${d.description})`),
    ...summary.owedToCharacter.map(d => `${d.counterparty} owes ${characterName} (${d.description})`),
  ]
}
