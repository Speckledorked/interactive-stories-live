// src/app/worlds/[slug]/page.tsx
//
// #490 — one world, and the button that turns reading into playing.
//
// Public, like the directory. Signed out, the button sends you to signup
// and comes back here: a stranger who has just decided they want this world
// is the single best moment to ask them to make an account, and losing
// their place on the way would waste it.
//
// Shows a summary rather than the definition. Enough to judge a world —
// what the factions are called, what kinds of power exist, how it opens —
// without handing over the thing forking is for.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { GitFork, Users, Sparkles } from 'lucide-react'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { Button } from '@/components/ui/button'
import { HEADER_OFFSET } from '@/components/tavern/headerOffset'
import { fontDisplay } from '@/lib/fonts'
import { pluralize } from '@/lib/format'
import { authenticatedFetch, isAuthenticated } from '@/lib/clientAuth'

interface WorldDetail {
  slug: string
  title: string
  description: string
  universe: string
  forkCount: number
  isListed: boolean
  author: string
  premise: string
  factionCount: number
  factionNames: string[]
  capabilityCount: number
  capabilityDomains: string[]
}

export default function WorldPage() {
  const router = useRouter()
  const params = useParams()
  const slug = params.slug as string

  const [world, setWorld] = useState<WorldDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [forking, setForking] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/public/worlds/${slug}`)
      if (!response.ok) throw new Error('That world could not be found.')
      setWorld((await response.json()).world)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load world')
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    load()
  }, [load])

  const handleFork = async () => {
    // Signed out, keep their place: they have just decided they want this
    // world, and dropping them on a bare signup page loses that.
    if (!isAuthenticated()) {
      router.push(`/signup?returnTo=/worlds/${slug}`)
      return
    }

    setForking(true)
    setError('')
    try {
      const response = await authenticatedFetch(`/api/worlds/${slug}/fork`, { method: 'POST' })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Could not start from this world')
      }
      const { campaignId } = await response.json()
      router.push(`/campaigns/${campaignId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start from this world')
      setForking(false)
    }
  }

  if (loading) {
    return (
      <TavernPage>
        <TavernHeader backHref="/worlds" title="Worlds" />
        <main className={`mx-auto max-w-2xl px-4 ${HEADER_OFFSET} pb-28`}>
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-2/3 rounded bg-myth-surface-sunken" />
            <div className="h-4 w-full rounded bg-myth-surface-sunken" />
            <div className="h-4 w-5/6 rounded bg-myth-surface-sunken" />
          </div>
        </main>
      </TavernPage>
    )
  }

  if (!world) {
    return (
      <TavernPage>
        <TavernHeader backHref="/worlds" title="Worlds" />
        <main className={`mx-auto max-w-2xl px-4 ${HEADER_OFFSET} pb-28 text-center`}>
          <p className="text-myth-ink-muted">{error || 'That world could not be found.'}</p>
        </main>
      </TavernPage>
    )
  }

  return (
    <TavernPage>
      <TavernHeader backHref="/worlds" title="Worlds" />

      <main className={`mx-auto max-w-2xl px-4 ${HEADER_OFFSET} pb-28`}>
        <h1 className={`${fontDisplay.className} mb-1 text-3xl font-semibold text-myth-ink`}>
          {world.title}
        </h1>
        <p className="mb-6 text-sm text-myth-ink-faint">
          {world.universe} · shared by {world.author}
          {world.forkCount > 0 && ` · ${world.forkCount} ${pluralize(world.forkCount, 'start')} from here`}
        </p>

        {world.description && (
          <p className="mb-8 leading-relaxed text-myth-ink-muted">{world.description}</p>
        )}

        {world.premise && (
          <section className="mb-8 rounded-lg border border-myth-border bg-myth-surface-sunken p-5">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-myth-ink-faint">
              How it opens
            </h2>
            <p className="whitespace-pre-line leading-relaxed text-myth-ink">{world.premise}</p>
          </section>
        )}

        <div className="mb-8 grid gap-4 sm:grid-cols-2">
          {world.factionCount > 0 && (
            <div className="rounded-lg border border-myth-border bg-myth-surface p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-myth-ink">
                <Users className="h-4 w-4 text-myth-accent" />
                {world.factionCount} {pluralize(world.factionCount, 'power')}
              </h3>
              <p className="text-sm text-myth-ink-muted">{world.factionNames.join(', ')}</p>
            </div>
          )}
          {world.capabilityCount > 0 && (
            <div className="rounded-lg border border-myth-border bg-myth-surface p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-myth-ink">
                <Sparkles className="h-4 w-4 text-myth-accent" />
                {world.capabilityCount} {pluralize(world.capabilityCount, 'thing')} to learn
              </h3>
              <p className="text-sm text-myth-ink-muted">{world.capabilityDomains.join(', ')}</p>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-myth-danger/30 bg-myth-danger/10 p-3">
            <p className="text-sm text-myth-danger">{error}</p>
          </div>
        )}

        <Button size="lg" fullWidth onClick={handleFork} disabled={forking}>
          {forking ? (
            'Making your copy…'
          ) : (
            <>
              <GitFork className="h-5 w-5" /> Start your own from this world
            </>
          )}
        </Button>
        <p className="mt-3 text-center text-xs text-myth-ink-faint">
          You get your own copy to run however you like. The original is untouched.
        </p>
      </main>
    </TavernPage>
  )
}
