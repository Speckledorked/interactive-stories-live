// src/app/worlds/page.tsx
//
// #490 — the world directory.
//
// Templates used to be three entries hard-coded in a TypeScript file, which
// meant that for a product entirely about invented worlds, the only worlds
// on offer were the three that shipped. This is where the ones people have
// actually built live.
//
// Public: no auth gate, same as the chronicle share pages. A stranger
// should be able to see what has been made here before being asked to sign
// up for anything — that is the whole reason a directory is worth having.

'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { GitFork, Search } from 'lucide-react'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { HEADER_OFFSET } from '@/components/tavern/headerOffset'
import { fontDisplay } from '@/lib/fonts'
import { pluralize } from '@/lib/format'

interface WorldCard {
  slug: string
  title: string
  description: string
  universe: string
  forkCount: number
  author: string
}

export default function WorldsPage() {
  const [worlds, setWorlds] = useState<WorldCard[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)

  const load = useCallback(async (search: string, from: number) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ offset: String(from) })
      if (search.trim()) params.set('q', search.trim())
      const response = await fetch(`/api/public/worlds?${params}`)
      if (!response.ok) return
      const data = await response.json()
      setWorlds((prev) => (from === 0 ? data.worlds : [...prev, ...data.worlds]))
      setHasMore(data.hasMore)
    } catch (error) {
      console.error('Failed to load worlds:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounced so typing a search does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(0)
      load(query, 0)
    }, 300)
    return () => clearTimeout(timer)
  }, [query, load])

  return (
    <TavernPage>
      <TavernHeader backHref="/" title="Worlds" />

      <main className={`mx-auto max-w-4xl px-4 ${HEADER_OFFSET} pb-28`}>
        <p className="mb-6 max-w-prose text-sm leading-relaxed text-myth-ink-faint">
          Worlds people have built and shared. Starting from one gives you your
          own copy — its factions, its powers, its calendar, its opening
          situation — to take wherever you want. Nothing you do in it touches
          anyone else&rsquo;s game.
        </p>

        <div className="relative mb-8">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-myth-ink-faint" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or setting"
            aria-label="Search worlds"
            className="pl-9"
          />
        </div>

        {worlds.length === 0 && !loading ? (
          <EmptyState
            icon={<GitFork className="h-8 w-8" />}
            title={query ? 'Nothing matches that' : 'No worlds shared yet'}
            description={
              query
                ? 'Try a different word, or clear the search to see everything.'
                : 'Be the first. Any campaign you run can be shared from its settings once it has factions or a power tree.'
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {worlds.map((world) => (
              <Link
                key={world.slug}
                href={`/worlds/${world.slug}`}
                className="group rounded-lg border border-myth-border bg-myth-surface p-5 transition-colors hover:border-myth-accent/50"
              >
                <h2
                  className={`${fontDisplay.className} mb-1 text-lg font-semibold text-myth-ink group-hover:text-myth-accent`}
                >
                  {world.title}
                </h2>
                <p className="mb-3 text-xs uppercase tracking-wide text-myth-ink-faint">
                  {world.universe}
                </p>
                {world.description && (
                  <p className="mb-4 line-clamp-3 text-sm text-myth-ink-muted">{world.description}</p>
                )}
                <div className="flex items-center justify-between text-xs text-myth-ink-faint">
                  <span>by {world.author}</span>
                  {world.forkCount > 0 && (
                    <span className="flex items-center gap-1">
                      <GitFork className="h-3 w-3" />
                      {world.forkCount} {pluralize(world.forkCount, 'start')}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

        {hasMore && (
          <div className="mt-8 text-center">
            <Button
              variant="secondary"
              disabled={loading}
              onClick={() => {
                const next = offset + worlds.length
                setOffset(next)
                load(query, worlds.length)
              }}
            >
              {loading ? 'Loading…' : 'Show more'}
            </Button>
          </div>
        )}
      </main>
    </TavernPage>
  )
}
