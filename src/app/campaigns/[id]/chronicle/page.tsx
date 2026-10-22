// src/app/campaigns/[id]/chronicle/page.tsx
//
// #522 — the whole history of the world moving on its own.
//
// The campaign overview's "What Changed" (#396) answers "what did I
// miss": bounded to the absence window, coverage-first selected, twelve
// entries. This is the other question — show me everything, let me page
// back — which nothing answered.
//
// Grouped by turn rather than listed flat. A world turn is the unit the
// simulation actually moves in, and a flat list of sentences loses the
// fact that eight of them happened at once.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SpinnerBlock } from '@/components/ui/spinner'
import { HEADER_OFFSET } from '@/components/tavern/headerOffset'
import { authenticatedFetch } from '@/lib/clientAuth'
import { fontDisplay } from '@/lib/fonts'
import type { WorldEventKind } from '@/lib/game/worldEventPhrasing'

interface ChronicleEntry {
  id: string
  turnNumber: number
  at: string
  text: string
  kind: WorldEventKind
  major: boolean
}

/** Short label per kind, so a turn's worth of lines is scannable. */
const KIND_LABELS: Record<WorldEventKind, string> = {
  power: 'Powers',
  territory: 'Ground',
  war: 'War',
  people: 'People',
  place: 'Places',
  thread: 'Threads',
}

export default function ChroniclePage() {
  const params = useParams()
  const campaignId = params.id as string

  const [entries, setEntries] = useState<ChronicleEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(
    async (from: string | null) => {
      try {
        const query = from ? `?cursor=${encodeURIComponent(from)}` : ''
        const response = await authenticatedFetch(
          `/api/campaigns/${campaignId}/world-chronicle${query}`
        )
        if (!response.ok) throw new Error('The chronicle could not be read.')
        const data = await response.json()
        // Appended rather than replaced, so paging back builds one
        // continuous history instead of swapping pages under the reader.
        setEntries((previous) => [...previous, ...(data.entries ?? [])])
        setCursor(data.nextCursor ?? null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The chronicle could not be read.')
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [campaignId]
  )

  useEffect(() => {
    load(null)
  }, [load])

  const loadMore = () => {
    if (!cursor) return
    setLoadingMore(true)
    load(cursor)
  }

  // Turn boundaries, in the order the entries already arrive (newest
  // first). Built by walking rather than grouping into a map, so the
  // server's ordering is the only thing deciding sequence.
  const turns: Array<{ turnNumber: number; entries: ChronicleEntry[] }> = []
  for (const entry of entries) {
    const current = turns[turns.length - 1]
    if (current && current.turnNumber === entry.turnNumber) current.entries.push(entry)
    else turns.push({ turnNumber: entry.turnNumber, entries: [entry] })
  }

  return (
    <TavernPage>
      <TavernHeader backHref={`/campaigns/${campaignId}`} title="Chronicle" />

      <main className={`mx-auto max-w-2xl px-4 ${HEADER_OFFSET} pb-28`}>
        <p className="mb-8 text-sm leading-relaxed text-myth-ink-muted">
          Everything the world has done on its own, newest first. Your own deeds live in the story
          log; this is the part that happened whether you were watching or not.
        </p>

        {loading ? (
          <SpinnerBlock />
        ) : error ? (
          <p className="text-sm text-myth-danger">{error}</p>
        ) : entries.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description="The world has not taken a turn of its own since this campaign began. Play on — it will."
          />
        ) : (
          <>
            <div className="space-y-8">
              {turns.map((turn) => (
                <section key={turn.turnNumber}>
                  <h2
                    className={`${fontDisplay.className} mb-3 border-b border-myth-border pb-1 text-sm font-semibold text-myth-ink-faint`}
                  >
                    Turn {turn.turnNumber}
                  </h2>
                  <ul className="space-y-2.5">
                    {turn.entries.map((entry) => (
                      <li key={entry.id} className="flex items-baseline gap-3">
                        <span className="w-16 flex-shrink-0 font-mono text-[10px] uppercase tracking-wider text-myth-ink-faint">
                          {KIND_LABELS[entry.kind]}
                        </span>
                        {/* Weight, not a badge: a major change should read
                            as more important without a second visual
                            vocabulary for the reader to learn. */}
                        <span
                          className={`text-sm leading-relaxed ${
                            entry.major ? 'text-myth-ink' : 'text-myth-ink-muted'
                          }`}
                        >
                          {entry.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            {cursor && (
              <div className="mt-10 flex justify-center">
                <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? 'Reading back…' : 'Further back'}
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      <TavernNav campaignId={campaignId} />
    </TavernPage>
  )
}
