// src/app/help/page.tsx
//
// The reference. Complete where the tutorial is deliberately not, and
// written in the language the UI actually uses.
//
// Search matters more here than structure. The realistic entry point is
// not "I want to read about information latency" — it is "the screen said
// Heard secondhand and I do not know what that means". So the search runs
// over each mechanic's aliases, and the aliases are the literal strings a
// player can see on screen. See mechanics.ts for the rule.
//
// The previous version of this page hardcoded "2d6 + Stat" and named the
// engine's own stat keys. Campaign.statLabels renames those per campaign
// and lib/ai/moveFlavor.ts renames the moves, so that copy described a
// vocabulary most players never see.

'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Keyboard, Search } from 'lucide-react'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { SectionHeader } from '@/components/ui/section-header'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { HEADER_OFFSET } from '@/components/tavern/headerOffset'
import { getLastCampaignId } from '@/lib/clientAuth'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  MECHANICS,
  searchMechanics,
  type Mechanic,
  type MechanicCategory,
} from '@/lib/tutorial/content/mechanics'

export default function HelpPage() {
  const [lastCampaignId, setLastCampaignId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    setLastCampaignId(getLastCampaignId())
  }, [])

  const results = useMemo(() => searchMechanics(query), [query])
  const isSearching = query.trim().length > 0

  const grouped = useMemo(() => {
    const map = new Map<MechanicCategory, Mechanic[]>()
    for (const mechanic of MECHANICS) {
      const list = map.get(mechanic.category) ?? []
      list.push(mechanic)
      map.set(mechanic.category, list)
    }
    return map
  }, [])

  return (
    <TavernPage>
      <TavernHeader backHref="/campaigns" title="Help" />

      <main className={`max-w-3xl mx-auto px-4 ${HEADER_OFFSET} pb-28`}>
        <p className="mb-6 max-w-prose text-sm leading-relaxed text-myth-ink-faint">
          Everything MythOS does, explained. If you saw a word on screen and
          want to know what it means, search for that word — it will find
          the right page.
        </p>

        <div className="relative mb-8">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-myth-ink-faint" />
          <Input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search — try &ldquo;heard secondhand&rdquo; or &ldquo;x-card&rdquo;"
            aria-label="Search help"
            className="pl-9"
          />
        </div>

        {/* #449: above the reference list, not below it.
            The quickstart is the only link to /tutorial, and it used to
            sit under all six categories — so a first-time visitor, who is
            exactly the person who wants the short guided version, had to
            scroll past the entire reference to find it. Rendering it as a
            footer also signalled "supplementary" for the page's most
            valuable destination.
            Search stays above it: "I saw a word and want to know what it
            means" is still the primary job of this page. */}
        {!isSearching && (
          <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Link
              href="/tutorial"
              className="group rounded-lg border border-myth-border bg-myth-surface p-5 transition-colors hover:border-myth-border-strong"
            >
              <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-myth-ink">
                How to play
                <ArrowRight className="h-4 w-4 text-myth-ink-faint transition-transform group-hover:translate-x-0.5" />
              </h2>
              <p className="text-sm leading-relaxed text-myth-ink-muted">
                The short version — enough to start, nothing you do not need yet.
              </p>
            </Link>

            <button
              type="button"
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))}
              className="min-h-[44px] rounded-lg border border-myth-border bg-myth-surface p-5 text-left transition-colors hover:border-myth-border-strong"
            >
              <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-myth-ink">
                <Keyboard className="h-5 w-5 text-myth-ink-faint" />
                Keyboard shortcuts
              </h2>
              <p className="text-sm leading-relaxed text-myth-ink-muted">
                Cmd+K opens the command palette from anywhere.
              </p>
            </button>
          </div>
        )}

        {isSearching ? (
          <section>
            <SectionHeader
              as="h2"
              title={`${results.length} ${results.length === 1 ? 'result' : 'results'}`}
            />
            {results.length === 0 ? (
              <div className="mt-6">
                <EmptyState
                  icon={<Search className="h-8 w-8" />}
                  title="Nothing matched that"
                  description="Try a word you saw on screen, or clear the search to browse everything."
                />
              </div>
            ) : (
              <ul className="mt-6 space-y-3">
                {results.map(mechanic => (
                  <MechanicLink key={mechanic.id} mechanic={mechanic} />
                ))}
              </ul>
            )}
          </section>
        ) : (
          <div className="space-y-10">
            {CATEGORY_ORDER.map(category => {
              const list = grouped.get(category) ?? []
              if (list.length === 0) return null

              return (
                <section key={category}>
                  <SectionHeader as="h2" title={CATEGORY_LABELS[category]} />
                  <ul className="mt-6 space-y-3">
                    {list.map(mechanic => (
                      <MechanicLink key={mechanic.id} mechanic={mechanic} />
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        )}

      </main>

      <TavernNav campaignId={lastCampaignId || undefined} />
    </TavernPage>
  )
}

function MechanicLink({ mechanic }: { mechanic: Mechanic }) {
  return (
    <li>
      <Link
        href={`/help/${mechanic.id}`}
        className="group flex min-h-[44px] flex-col justify-center rounded-lg border border-myth-border bg-myth-surface px-4 py-3 transition-colors hover:border-myth-border-strong"
      >
        <span className="flex items-center gap-2 font-bold text-myth-ink">
          {mechanic.term}
          <ArrowRight className="h-4 w-4 text-myth-ink-faint transition-transform group-hover:translate-x-0.5" />
        </span>
        <span className="mt-0.5 text-sm leading-relaxed text-myth-ink-muted">{mechanic.short}</span>
      </Link>
    </li>
  )
}
