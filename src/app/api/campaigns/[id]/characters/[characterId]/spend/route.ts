// src/app/api/campaigns/[id]/characters/[characterId]/spend/route.ts
//
// #416: the player-side spend surface. GET quotes the catalogue for this
// character; POST takes one of its entries.
//
// Every price and every effect is computed by lib/game/spending.ts from
// state the engine already owns. Nothing here reads an AI-authored field,
// and the request body cannot carry a cost — the client says WHAT it wants,
// never WHAT IT COSTS. That is the same boundary reward_grant, harm_healing
// and rest_quality already sit behind, applied to the one direction the
// economy was missing.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { requireCharacterOwner } from '@/lib/db/characterAccess'
import { SPEND_LIMIT, checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import {
  offersFor,
  priceOf,
  canAfford,
  isPurchaseKind,
  HARM_TREATED_PER_PURCHASE,
  type PurchaseKind,
} from '@/lib/game/spending'
import { isItemRarity, itemUnitValue, type ItemRarity } from '@/lib/game/itemValue'
import { applyGoldDelta } from '@/lib/game/economy'
import { healHarm, type HarmLevel } from '@/lib/game/harm'

type Params = { params: { id: string; characterId: string } }

function goldOf(resources: unknown): number {
  const gold = (resources as { gold?: unknown } | null)?.gold
  return typeof gold === 'number' && Number.isFinite(gold) ? Math.max(0, Math.trunc(gold)) : 0
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await getUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const owned = await requireCharacterOwner(user.userId, params.characterId)
    if ('response' in owned) return owned.response
    if (owned.character.campaignId !== params.id) {
      return NextResponse.json({ error: 'Character not found or does not belong to you' }, { status: 403 })
    }

    const gold = goldOf(owned.character.resources)

    // The settle_debt entry needs something to settle, and this is the only
    // request the panel makes — returning the debts here keeps the client
    // from having to know which other route owns them.
    const debts = await prisma.debt.findMany({
      where: { characterId: owned.character.id, status: 'OUTSTANDING', direction: 'OWED_BY_CHARACTER' },
      orderBy: [{ turnCreated: 'asc' }, { id: 'asc' }],
      take: 25,
      select: { id: true, counterpartyName: true, description: true },
    })

    return NextResponse.json({
      gold,
      debts,
      offers: offersFor(gold, { harm: owned.character.harm }),
    })
  } catch (error) {
    console.error('Get spend catalogue error:', error)
    return NextResponse.json({ error: 'Failed to load the catalogue' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await getUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rateLimit = await checkRateLimit(user.userId, SPEND_LIMIT.bucket, SPEND_LIMIT.limit, SPEND_LIMIT.windowSeconds)
    if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit)

    const owned = await requireCharacterOwner(user.userId, params.characterId)
    if ('response' in owned) return owned.response
    const character = owned.character
    if (character.campaignId !== params.id) {
      return NextResponse.json({ error: 'Character not found or does not belong to you' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const kind: unknown = body?.kind
    if (!isPurchaseKind(kind)) {
      return NextResponse.json({ error: 'Unknown purchase' }, { status: 400 })
    }

    const rarity: ItemRarity | undefined = isItemRarity(body?.rarity) ? body.rarity : undefined
    const quote = priceOf(kind as PurchaseKind, { harm: character.harm, rarity })
    const gold = goldOf(character.resources)
    const affordability = canAfford(gold, quote)
    if (!affordability.affordable) {
      return NextResponse.json({ error: affordability.reason ?? 'Not available.' }, { status: 400 })
    }

    // Everything below happens in ONE transaction. A purchase that debited
    // gold and then failed to apply its effect would be strictly worse than
    // no spend surface at all — this is a player's money, and "it took the
    // gold and nothing happened" is the one outcome that must be impossible.
    const result = await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction and re-check affordability against
      // that read. The quote above was computed from a row fetched before
      // the transaction began, so two purchases submitted together could
      // otherwise both pass the check and both debit.
      const fresh = await tx.character.findUnique({
        where: { id: character.id },
        select: { id: true, name: true, harm: true, resources: true },
      })
      if (!fresh) throw new Error('character disappeared mid-purchase')

      const freshGold = goldOf(fresh.resources)
      if (freshGold < quote.cost) {
        return { ok: false as const, error: `Costs ${quote.cost} gold; you have ${freshGold}.` }
      }

      const resources = { ...((fresh.resources as Record<string, unknown>) || {}) }
      resources.gold = applyGoldDelta(freshGold, -quote.cost)

      let receipt: string

      switch (kind as PurchaseKind) {
        case 'settle_debt': {
          const debtId: unknown = body?.debtId
          if (typeof debtId !== 'string' || debtId.length === 0) {
            return { ok: false as const, error: 'Name the debt you are settling.' }
          }
          // updateMany with the full predicate, not update-by-id: this is
          // what makes a double submit a no-op rather than a second payment
          // for an already-settled favor.
          const settled = await tx.debt.updateMany({
            where: {
              id: debtId,
              characterId: character.id,
              status: 'OUTSTANDING',
              direction: 'OWED_BY_CHARACTER',
            },
            data: { status: 'RESOLVED', resolution: 'Paid off in coin', resolvedAt: new Date() },
          })
          if (settled.count === 0) {
            return { ok: false as const, error: 'That debt is not yours, or is already settled.' }
          }
          receipt = 'Debt settled in coin.'
          break
        }

        case 'treat_harm': {
          if (fresh.harm <= 0) return { ok: false as const, error: 'Nothing to treat.' }
          const healed = healHarm(fresh.harm as HarmLevel, HARM_TREATED_PER_PURCHASE)
          await tx.character.update({ where: { id: character.id }, data: { harm: healed.newHarm } })
          receipt = healed.message
          break
        }

        case 'commission_item': {
          const name: unknown = body?.name
          if (typeof name !== 'string' || name.trim().length === 0) {
            return { ok: false as const, error: 'Name the piece of equipment.' }
          }
          const inventory = Array.isArray((fresh.resources as { items?: unknown })?.items)
            ? [...((fresh.resources as { items: unknown[] }).items)]
            : []
          inventory.push({
            name: name.trim().slice(0, 120),
            quantity: 1,
            rarity,
            // Priced by the engine off the rarity tier, never by the
            // requester — itemUnitValue is the same clamp the grant path
            // uses, so a purchase cannot launder value into carried wealth.
            value: itemUnitValue({ rarity, value: quote.cost }),
          })
          resources.items = inventory
          receipt = `Commissioned ${name.trim()}.`
          break
        }
      }

      await tx.character.update({ where: { id: character.id }, data: { resources: resources as never } })

      return { ok: true as const, receipt, goldAfter: resources.gold as number }
    })

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

    return NextResponse.json({ receipt: result.receipt, gold: result.goldAfter, spent: quote.cost })
  } catch (error) {
    console.error('Spend error:', error)
    return NextResponse.json({ error: 'Failed to complete the purchase' }, { status: 500 })
  }
}
