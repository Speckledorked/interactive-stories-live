'use client'

import { useEffect, useState } from 'react'
import { Compass } from 'lucide-react'
import { authenticatedFetch } from '@/lib/clientAuth'

interface Quest {
  id: string
  name: string
  description: string
  objective: string | null
  givenBy: string | null
  status: string
  updatedAt: string
}

// Surfaces the player's active quest as a concrete "what to do next"
// pointer, distinct from WorldChronicle's atmosphere prose below it.
// Reuses the existing member-facing quest log route (no new backend) —
// picks the first ACTIVE entry from its updatedAt-desc order, i.e. the
// most recently touched active quest, as a reasonable proxy for "current
// focus" without new query logic. Self-fetching, same pattern as
// CampaignHero's own polling — renders nothing while loading or when
// there's no active quest, same graceful-degradation convention as
// WorldGlance/WorldChronicle.
export function CurrentObjective({ campaignId }: { campaignId: string }) {
  const [quest, setQuest] = useState<Quest | null | undefined>(undefined)

  useEffect(() => {
    authenticatedFetch(`/api/campaigns/${campaignId}/quests`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const active = (data?.quests as Quest[] | undefined)?.find((q) => q.status === 'ACTIVE')
        setQuest(active ?? null)
      })
      .catch(() => setQuest(null))
  }, [campaignId])

  if (!quest) return null

  return (
    <div className="rounded-lg border-l-4 border-myth-accent bg-myth-surface-raised p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-myth-accent/10 text-myth-accent">
          <Compass className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-wider text-myth-ink-faint">Current Objective</p>
          <h3 className="mt-0.5 font-display text-lg font-semibold text-myth-ink">{quest.name}</h3>
          <p className="mt-1 text-sm text-myth-ink-muted">{quest.objective || quest.description}</p>
          {quest.givenBy && <p className="mt-2 text-xs text-myth-ink-faint">Given by {quest.givenBy}</p>}
        </div>
      </div>
    </div>
  )
}
