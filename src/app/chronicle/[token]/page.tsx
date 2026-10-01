// src/app/chronicle/[token]/page.tsx
// Public, unauthenticated, read-only story log — the destination for a
// campaign's chronicle share link (see api/campaigns/[id]/chronicle-share
// for the GM toggle, api/public/chronicle/[token] for the data it reads).
// No login, no character sheets, no admin data — just the resolved scenes,
// in order, for anyone the link is shared with. The strongest narrative
// candidate in the app outside WorldChronicle itself — no card chrome,
// flowing prose, divider lines between scenes (see docs/design-system.md).

'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { GitFork } from 'lucide-react'
import { fontDisplay, fontSans } from '@/lib/fonts'
import { SectionHeader } from '@/components/ui/section-header'

interface ChronicleScene {
  sceneNumber: number
  introText: string
  resolutionText: string | null
}

interface ChronicleData {
  campaign: { title: string; description: string | null; universe: string | null }
  // #490: set when this campaign's world is published and listed, so a
  // reader can start their own from it. Null otherwise — and the CTA simply
  // does not render, rather than linking somewhere that would 404.
  worldSlug: string | null
  scenes: ChronicleScene[]
}

export default function PublicChroniclePage() {
  const params = useParams()
  const token = params.token as string

  const [data, setData] = useState<ChronicleData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/public/chronicle/${token}`)
      .then(async res => {
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.error || 'This chronicle link is not available')
        }
        return res.json()
      })
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load chronicle'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div className="-mx-4 -my-8 flex min-h-screen items-center justify-center bg-myth-canvas">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-myth-accent" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="-mx-4 -my-8 flex min-h-screen items-center justify-center bg-myth-canvas px-4">
        <div className="text-center">
          <p className={`mb-2 text-xl font-semibold text-myth-ink ${fontDisplay.className}`}>Chronicle unavailable</p>
          <p className="text-sm text-myth-ink-muted">{error || 'This link may have been disabled.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`${fontSans.className} -mx-4 -my-8 min-h-screen bg-myth-canvas`}>
      <header className="border-b border-myth-border px-4 py-8 text-center">
        <p className="mb-2 text-xs uppercase tracking-widest text-myth-ink-faint">A Chronicle From MythOS</p>
        <h1 className={`mb-2 text-3xl font-semibold text-myth-ink ${fontDisplay.className}`}>{data.campaign.title}</h1>
        {data.campaign.universe && (
          <p className="text-sm text-myth-ink-faint">{data.campaign.universe}</p>
        )}
        {data.campaign.description && (
          <p className="mx-auto mt-3 max-w-xl text-sm text-myth-ink-muted">{data.campaign.description}</p>
        )}
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10">
        {data.scenes.length === 0 ? (
          <p className="text-center text-myth-ink-faint">No scenes have concluded yet — check back once the story&apos;s underway.</p>
        ) : (
          <div className="divide-y divide-myth-border">
            {data.scenes.map(scene => (
              <article key={scene.sceneNumber} className="py-8 first:pt-0 last:pb-0">
                <SectionHeader
                  as="h2"
                  title={`Scene ${scene.sceneNumber}`}
                />
                <p className="mt-3 whitespace-pre-wrap leading-relaxed text-myth-ink">{scene.introText}</p>
                {scene.resolutionText && (
                  <p className="mt-4 whitespace-pre-wrap leading-relaxed text-myth-ink-muted">{scene.resolutionText}</p>
                )}
              </article>
            ))}
          </div>
        )}
      </main>

      {/* #490: the link out. A chronicle share link was a well-built dead
          end — someone could read a whole campaign and have nowhere to go
          with it. Rendered below the story rather than above it on purpose:
          the pitch is the story, so it has to be read first. */}
      {data.worldSlug && (
        <section className="border-t border-myth-border px-4 py-10 text-center">
          <p className="mx-auto mb-4 max-w-md text-sm text-myth-ink-muted">
            This world is one you can play in. Starting from it gives you your own
            copy — the same factions, powers and opening situation — to take
            wherever you like.
          </p>
          <Link
            href={`/worlds/${data.worldSlug}`}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-myth-accent px-6 py-3 font-semibold text-myth-accent-ink transition-opacity hover:opacity-90"
          >
            <GitFork className="h-4 w-4" />
            Start your own from this world
          </Link>
        </section>
      )}

      <footer className="pb-8 text-center text-xs text-myth-ink-faint">
        A read-only chronicle — no login required.
      </footer>
    </div>
  )
}
