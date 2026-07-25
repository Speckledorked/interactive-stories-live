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

/**
 * Translate a `consequences_add` entry of type 'debt' into a real
 * DebtChange (#69). Pure; returns null when it can't become a debt.
 *
 * Why this exists: a narrator reporting a debt reaches for the consequence
 * channel as often as for debt_changes — it's the obvious place to put
 * "and now they owe someone". That used to write a freeform string into
 * consequences.debts, a shadow of the real Debt model that carried no
 * direction, no counterparty and no status, and never reached the prompt
 * as leverage. Removing the type from the schema stopped the shadow but
 * lost the fiction outright: the entry was rejected at the boundary and
 * nothing was recorded anywhere. This keeps the convenient way in and
 * lands it in the one real model.
 *
 * counterparty_name is the one thing a Debt needs that a consequence
 * doesn't inherently carry, so an entry without it returns null — better
 * a logged drop than a debt owed to nobody, which nothing could ever call
 * in. Direction defaults to owed_by_character: a bare "this became a debt"
 * means the party owes someone, and inverting that by accident would hand
 * players leverage they never earned.
 */
export function debtChangeFromConsequence(entry: {
  type: string
  description?: string
  counterparty_name?: string
  counterparty_type?: 'npc' | 'faction'
  direction?: 'owed_by_character' | 'owed_to_character'
}): DebtChange | null {
  if (entry.type !== 'debt') return null
  const name = entry.counterparty_name?.trim()
  const description = entry.description?.trim()
  if (!name || !description) return null
  return {
    counterparty_name: name,
    counterparty_type: entry.counterparty_type === 'faction' ? 'faction' : 'npc',
    direction: entry.direction === 'owed_to_character' ? 'owed_to_character' : 'owed_by_character',
    action: 'incur',
    description,
    reason: 'Reported as a consequence of this scene',
  }
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

// ---------------------------------------------------------------------------
// Roll-time weight (the Debt half of the economy question)
// ---------------------------------------------------------------------------
//
// Debt was the one Urban Shadows currency with no mechanical weight.
// Standing moves a roll, relationships move a roll, corruption moves a
// roll — Debt reached the prompt as prose and stopped there, so "the
// social currency of this world" was the only currency that bought
// nothing. This is that weight.
//
// The direction is the whole point, and it cuts both ways:
//
//   they owe YOU   — leverage you can call in. A favor outstanding is
//                    exactly the thing you spend when you need something.
//   you owe THEM   — leverage they hold. "You already owe me" is a real
//                    answer to a request, and being in someone's debt
//                    genuinely weakens your position with them.
//
// Netted rather than summed separately, because owing someone who also
// owes you is a wash — that's two people square with each other, not two
// independent pressures.

/** Outstanding debts with the ONE counterparty a roll named. */
export interface DebtsForRoll {
  counterpartyName: string
  owedToCharacter: number
  owedByCharacter: number
}

/**
 * How much the debt ledger with a named counterparty shifts a roll.
 *
 * Capped at ±2 to sit alongside standing and relationships rather than
 * dominate them, and deliberately NOT linear past the first favor: one
 * outstanding debt is worth ±1, two or more ±2. A pile of small favors
 * shouldn't out-weigh a deep faction standing, and without the flattening
 * a narrator that likes recording debts would quietly inflate the scale.
 *
 * Pure.
 */
export function debtModifier(debts: DebtsForRoll | null | undefined): number {
  if (!debts) return 0
  const owedTo = Math.max(0, Math.trunc(Number(debts.owedToCharacter) || 0))
  const owedBy = Math.max(0, Math.trunc(Number(debts.owedByCharacter) || 0))
  const net = owedTo - owedBy
  if (net === 0) return 0
  const magnitude = Math.abs(net) >= 2 ? 2 : 1
  return net > 0 ? magnitude : -magnitude
}

/** Short receipt phrasing — diegetic, never a count. */
export function describeDebtLeverage(debts: DebtsForRoll, mod: number): string {
  if (mod > 0) return `${debts.counterpartyName} owes you`
  return `you owe ${debts.counterpartyName}`
}

interface DebtRowForWeight {
  direction: DebtDirection
  counterpartyName: string
  counterpartyId: string | null
}

/**
 * Collapse a character's outstanding debts down to the ledger with ONE
 * named counterparty. Pure, so the orchestrator fetches every open debt
 * for the acting characters once per exchange rather than querying per
 * action.
 *
 * Matched on resolved id when both sides have one, else on name — the same
 * id-then-name fallback weather and contested territory already use, and
 * for the same reason: counterpartyId is only set when the name matched a
 * known entity at the time the debt was incurred.
 */
export function debtsWithCounterparty(
  rows: DebtRowForWeight[],
  counterparty: { id: string; name: string }
): DebtsForRoll | null {
  const wanted = counterparty.name.trim().toLowerCase()
  const matching = rows.filter(
    r =>
      (r.counterpartyId && r.counterpartyId === counterparty.id) ||
      r.counterpartyName.trim().toLowerCase() === wanted
  )
  if (matching.length === 0) return null

  return {
    counterpartyName: counterparty.name,
    owedToCharacter: matching.filter(r => r.direction === 'OWED_TO_CHARACTER').length,
    owedByCharacter: matching.filter(r => r.direction === 'OWED_BY_CHARACTER').length,
  }
}
