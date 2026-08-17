// src/app/help/[mechanicId]/page.tsx
//
// A single mechanic, in full.
//
// This is where ./content/labels.ts earns its place. The registry copy is
// written to be correct with no campaign in context ("your traits"), and
// this page upgrades it to the campaign's own vocabulary when there is a
// campaign to read it from. The fallback is the default and always renders
// a complete sentence — nothing here is a template with a visible hole.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { EmptyState } from '@/components/ui/empty-state'
import { HEADER_OFFSET } from '@/components/tavern/headerOffset'
import { authenticatedFetch, getLastCampaignId, isAuthenticated } from '@/lib/clientAuth'
import { getMechanic } from '@/lib/tutorial/content/mechanics'
import { formatNameList, readStatLabels } from '@/lib/tutorial/content/labels'

/** Mechanics whose copy is improved by knowing the campaign's own names. */
const LABEL_AWARE = new Set(['character-sheet', 'origins', 'actions'])

export default function MechanicPage() {
  const params = useParams<{ mechanicId: string }>()
  const mechanicId = typeof params?.mechanicId === 'string' ? params.mechanicId : ''
  const mechanic = getMechanic(mechanicId)

  const [lastCampaignId, setLastCampaignId] = useState<string | null>(null)
  const [traitNames, setTraitNames] = useState<string[]>([])

  useEffect(() => {
    setLastCampaignId(getLastCampaignId())
  }, [])

  useEffect(() => {
    if (!mechanic || !LABEL_AWARE.has(mechanic.id)) return
    if (!isAuthenticated()) return

    const campaignId = getLastCampaignId()
    if (!campaignId) return

    let cancelled = false

    void (async () => {
      try {
        const response = await authenticatedFetch(`/api/campaigns/${campaignId}`)
        if (!response.ok || cancelled) return
        const data = await response.json()
        if (cancelled) return
        // readStatLabels returns [] for anything it does not recognise, so
        // an old or partial blob falls back rather than rendering a
        // half-renamed list.
        setTraitNames(readStatLabels(data?.campaign?.statLabels))
      } catch {
        // No campaign context available. The generic copy already reads
        // correctly on its own.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [mechanic])

  if (!mechanic) {
    return (
      <TavernPage>
        <TavernHeader backHref="/help" title="Help" />
        <main className={`max-w-3xl mx-auto px-4 ${HEADER_OFFSET} pb-28`}>
          <EmptyState
            title="No such page"
            description="That help topic does not exist. Try searching from the help index."
            action={{ label: 'Back to Help', href: '/help' }}
          />
        </main>
        <TavernNav />
      </TavernPage>
    )
  }

  return (
    <TavernPage>
      <TavernHeader backHref="/help" title={mechanic.term} />

      <main className={`max-w-3xl mx-auto px-4 ${HEADER_OFFSET} pb-28`}>
        <p className="mb-8 max-w-prose text-base leading-relaxed text-myth-ink">{mechanic.short}</p>

        <div className="space-y-4">
          {mechanic.body.map((paragraph, i) => (
            <p key={i} className="max-w-prose text-sm leading-relaxed text-myth-ink-muted">
              {paragraph}
            </p>
          ))}
        </div>

        {traitNames.length > 0 && (
          <div className="mt-8 rounded-lg border border-myth-border bg-myth-surface p-5">
            <h2 className="mb-2 text-sm font-bold text-myth-ink">In your current campaign</h2>
            <p className="text-sm leading-relaxed text-myth-ink-muted">
              Your traits are called {formatNameList(traitNames)}. Every campaign
              names them for its own world, so these will read differently in
              another one.
            </p>
          </div>
        )}

        {mechanic.seeAlso && mechanic.seeAlso.length > 0 && (
          <div className="mt-10 border-t border-myth-border pt-6">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-myth-ink-faint">
              Related
            </h2>
            <ul className="space-y-2">
              {mechanic.seeAlso.map(id => {
                const related = getMechanic(id)
                if (!related) return null
                return (
                  <li key={id}>
                    <Link
                      href={`/help/${related.id}`}
                      className="group inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-myth-accent hover:text-myth-ink"
                    >
                      {related.term}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <div className="mt-10">
          <Link
            href="/help"
            className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-myth-ink-muted hover:text-myth-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            All help topics
          </Link>
        </div>
      </main>

      <TavernNav campaignId={lastCampaignId || undefined} />
    </TavernPage>
  )
}
