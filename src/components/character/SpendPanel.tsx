'use client'

// src/components/character/SpendPanel.tsx
//
// #416: where a player actually spends.
//
// Self-contained on purpose — it fetches its own catalogue rather than
// taking one as a prop, because prices depend on live character state
// (harm, gold) that the sheet's cached `character` object can be stale
// about the moment anything else in the app writes to it. The server is the
// only thing that knows what a purchase costs, and asking it is one request.
//
// Blocked options are rendered, greyed, with their reason. Hiding them is
// what taught players the economy was decorative.

import { useCallback, useEffect, useState } from 'react'
import { authenticatedFetch } from '@/lib/clientAuth'

interface Offer {
  kind: 'settle_debt' | 'treat_harm' | 'commission_item'
  label: string
  effect: string
  cost: number
  affordable: boolean
  blockedReason?: string
}

interface OutstandingDebt {
  id: string
  counterpartyName: string
  description: string
}

interface SpendPanelProps {
  campaignId: string
  characterId: string
  currencyPlural: string
  /** Called after a successful purchase so the sheet can refetch. */
  onPurchased?: () => void
}

const RARITIES = ['common', 'uncommon', 'rare'] as const

export function SpendPanel({
  campaignId,
  characterId,
  currencyPlural,
  onPurchased,
}: SpendPanelProps) {
  const [offers, setOffers] = useState<Offer[] | null>(null)
  const [gold, setGold] = useState(0)
  const [debts, setDebts] = useState<OutstandingDebt[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [debtId, setDebtId] = useState('')
  const [itemName, setItemName] = useState('')
  const [rarity, setRarity] = useState<(typeof RARITIES)[number]>('common')

  const base = `/api/campaigns/${campaignId}/characters/${characterId}/spend`

  const load = useCallback(async () => {
    try {
      const response = await authenticatedFetch(base)
      if (!response.ok) return
      const body = await response.json()
      setOffers(body.offers)
      setGold(body.gold)
      setDebts(body.debts ?? [])
    } catch {
      // Non-critical: the panel just stays unrendered.
    }
  }, [base])

  useEffect(() => {
    load()
  }, [load])

  const purchase = async (offer: Offer) => {
    setBusy(offer.kind)
    setStatus(null)
    try {
      const response = await authenticatedFetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Deliberately no cost/price field. The server prices it; the
        // client only says what it wants.
        body: JSON.stringify({
          kind: offer.kind,
          ...(offer.kind === 'settle_debt' ? { debtId } : {}),
          ...(offer.kind === 'commission_item' ? { name: itemName, rarity } : {}),
        }),
      })
      const body = await response.json()
      if (!response.ok) {
        setStatus({ ok: false, text: body.error || 'That did not go through.' })
        return
      }
      setStatus({ ok: true, text: `${body.receipt} (−${body.spent} ${currencyPlural})` })
      setItemName('')
      setDebtId('')
      await load()
      onPurchased?.()
    } catch {
      setStatus({ ok: false, text: 'That did not go through.' })
    } finally {
      setBusy(null)
    }
  }

  if (!offers) return null

  const canTake = (offer: Offer) => {
    if (!offer.affordable) return false
    if (offer.kind === 'settle_debt') return debts.length > 0 && debtId.length > 0
    if (offer.kind === 'commission_item') return itemName.trim().length > 0
    return true
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-myth-ink-muted">
        You have {gold} {currencyPlural}. Prices are set by the world, not by the telling of it.
      </p>

      {status && (
        <p className={`text-sm ${status.ok ? 'text-myth-good' : 'text-myth-danger'}`}>{status.text}</p>
      )}

      <div className="space-y-3">
        {offers.map((offer) => (
          <div
            key={offer.kind}
            className="rounded-lg border border-myth-border bg-myth-surface-sunken p-4"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-medium text-myth-ink">{offer.label}</p>
              <p className="whitespace-nowrap text-sm text-myth-ink-faint">
                {offer.cost > 0 ? `${offer.cost} ${currencyPlural}` : '—'}
              </p>
            </div>
            <p className="mt-1 text-sm text-myth-ink-muted">{offer.effect}</p>

            {offer.kind === 'settle_debt' && offer.affordable && (
              <select
                aria-label="Debt to settle"
                value={debtId}
                onChange={(e) => setDebtId(e.target.value)}
                className="mt-3 w-full rounded-md border border-myth-border bg-myth-surface px-3 py-2 text-sm text-myth-ink"
              >
                <option value="">Which debt?</option>
                {debts.map((debt) => (
                  <option key={debt.id} value={debt.id}>
                    {debt.counterpartyName} — {debt.description}
                  </option>
                ))}
              </select>
            )}

            {offer.kind === 'commission_item' && offer.affordable && (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  aria-label="Equipment name"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  placeholder="What are you commissioning?"
                  className="flex-1 rounded-md border border-myth-border bg-myth-surface px-3 py-2 text-sm text-myth-ink"
                />
                <select
                  aria-label="Equipment grade"
                  value={rarity}
                  onChange={(e) => setRarity(e.target.value as (typeof RARITIES)[number])}
                  className="rounded-md border border-myth-border bg-myth-surface px-3 py-2 text-sm capitalize text-myth-ink"
                >
                  {RARITIES.map((r) => (
                    <option key={r} value={r} className="capitalize">
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {offer.blockedReason ? (
              <p className="mt-3 text-xs text-myth-ink-faint">{offer.blockedReason}</p>
            ) : (
              <button
                type="button"
                disabled={!canTake(offer) || busy !== null}
                onClick={() => purchase(offer)}
                className="mt-3 min-h-[44px] rounded-md border border-myth-border px-4 text-sm text-myth-ink transition-colors hover:border-myth-border-strong disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === offer.kind ? 'Paying…' : 'Pay'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
