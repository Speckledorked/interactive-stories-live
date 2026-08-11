// src/app/chronicle/[token]/recap/[logId]/page.tsx
// Public, unauthenticated recap page — the human-readable destination a
// shared recap link points to. The actual "shareable card" a link preview
// shows is opengraph-image.tsx, colocated in this same route segment (Next
// wires it up automatically); this page is what someone lands on after
// clicking through from that card.

'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { fontDisplay, fontSans } from '@/lib/fonts'

interface RecapData {
  campaign: { title: string; universe: string | null; heroImageUrl: string | null }
  recap: {
    title: string
    summary: string
    highlights: string[]
    entryType: string
    inGameDate: string | null
    turnNumber: number
  }
}

export default function PublicRecapPage() {
  const params = useParams()
  const token = params.token as string
  const logId = params.logId as string

  const [data, setData] = useState<RecapData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/public/chronicle/${token}/recap/${logId}`)
      .then(async res => {
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.error || 'This recap is not available')
        }
        return res.json()
      })
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load recap'))
      .finally(() => setLoading(false))
  }, [token, logId])

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
          <p className={`mb-2 text-xl font-semibold text-myth-ink ${fontDisplay.className}`}>Recap unavailable</p>
          <p className="text-sm text-myth-ink-muted">{error || 'This link may have been disabled.'}</p>
        </div>
      </div>
    )
  }

  const { campaign, recap } = data

  return (
    <div className={`${fontSans.className} -mx-4 -my-8 min-h-screen bg-myth-canvas`}>
      {campaign.heroImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- no next/image remote-host config exists yet
        <img
          src={campaign.heroImageUrl}
          alt=""
          className="h-56 w-full object-cover sm:h-72"
        />
      )}

      <header className="border-b border-myth-border px-4 py-8 text-center">
        <p className="mb-2 text-xs uppercase tracking-widest text-myth-ink-faint">
          A Recap From {campaign.title}
        </p>
        <h1 className={`mb-2 text-3xl font-semibold text-myth-ink ${fontDisplay.className}`}>{recap.title}</h1>
        {recap.inGameDate && (
          <p className="text-sm text-myth-ink-faint">{recap.inGameDate}</p>
        )}
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="whitespace-pre-wrap text-lg leading-relaxed text-myth-ink">{recap.summary}</p>

        {recap.highlights.length > 0 && (
          <div className="mt-8 border-t border-myth-border pt-6">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-myth-ink-faint">Key Moments</h2>
            <ul className="space-y-2">
              {recap.highlights.map((highlight, i) => (
                <li key={i} className="flex items-start gap-2 text-myth-ink-muted">
                  <span className="mt-1 text-myth-accent">•</span>
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-10 text-center">
          <Link
            href={`/chronicle/${token}`}
            className="text-sm text-myth-accent hover:underline"
          >
            Read the full chronicle of {campaign.title} →
          </Link>
        </div>
      </main>

      <footer className="pb-8 text-center text-xs text-myth-ink-faint">
        A read-only recap — no login required.
      </footer>
    </div>
  )
}
