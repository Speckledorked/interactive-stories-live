// Left-aligned page hero for the campaign lobby: display-serif title, a
// single italic log-line instead of a paragraph, and Universe/Turn/Date
// collapsed into one row of tabular-mono chips.
//
// heroImageUrl is generated exactly once, at campaign creation
// (campaignCreation.ts) — a campaign created before that feature shipped,
// or whose generation failed, never gets a retroactive attempt. When
// isAdmin and there's no image yet, this renders a manual "Generate hero
// art" trigger (POST /api/campaigns/[id]/hero-image) instead, polling the
// campaign for a bounded window until the image is ready or generation
// fails.

'use client'

import { useEffect, useRef, useState } from 'react'
import { authenticatedFetch } from '@/lib/clientAuth'

const POLL_INTERVAL_MS = 4000
const MAX_POLLS = 15 // ~60s

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded border border-myth-border bg-myth-surface-sunken px-2 py-1 font-mono text-xs">
      <span className="text-myth-ink-faint">{label}</span>
      <span className="text-myth-ink">{value}</span>
    </div>
  )
}

export function CampaignHero({
  campaignId,
  title,
  description,
  universe,
  turnNumber,
  inGameDate,
  heroImageUrl,
  heroImageStatus,
  isAdmin = false,
}: {
  campaignId: string
  title: string
  description?: string
  universe?: string
  turnNumber: number
  inGameDate: string
  heroImageUrl?: string | null
  heroImageStatus?: string | null
  isAdmin?: boolean
}) {
  const [imageUrl, setImageUrl] = useState(heroImageUrl ?? null)
  const [status, setStatus] = useState(heroImageStatus ?? 'NONE')
  const pollCount = useRef(0)

  useEffect(() => {
    setImageUrl(heroImageUrl ?? null)
    setStatus(heroImageStatus ?? 'NONE')
  }, [heroImageUrl, heroImageStatus])

  useEffect(() => {
    if (status !== 'PENDING') return
    pollCount.current = 0

    const interval = setInterval(async () => {
      pollCount.current += 1
      try {
        const response = await authenticatedFetch(`/api/campaigns/${campaignId}`)
        if (response.ok) {
          const data = await response.json()
          const nextStatus = data?.campaign?.heroImageStatus
          if (nextStatus === 'READY') {
            setImageUrl(data.campaign.heroImageUrl ?? null)
            setStatus('READY')
            clearInterval(interval)
            return
          }
          if (nextStatus === 'FAILED') {
            setStatus('FAILED')
            clearInterval(interval)
            return
          }
        }
      } catch {
        // Transient poll failure — try again next tick rather than giving up.
      }
      if (pollCount.current >= MAX_POLLS) {
        clearInterval(interval)
      }
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [status, campaignId])

  const handleGenerate = async () => {
    setStatus('PENDING')
    try {
      await authenticatedFetch(`/api/campaigns/${campaignId}/hero-image`, { method: 'POST' })
    } catch {
      setStatus('FAILED')
    }
  }

  return (
    <div className="relative mb-8 overflow-hidden rounded-lg">
      {imageUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- no next/image remote-host config exists yet; plain <img> matches the only existing convention in the app (wiki/page.tsx). */}
          <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-myth-canvas via-myth-canvas/70 to-transparent" />
        </>
      )}
      <div className={imageUrl ? 'relative px-5 py-10 sm:py-14' : ''}>
        <h1 className="font-display text-3xl font-semibold text-myth-ink sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 italic text-myth-ink-muted">{description}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {universe && <MetaChip label="Universe" value={universe} />}
          <MetaChip label="Turn" value={String(turnNumber)} />
          <MetaChip label="Date" value={inGameDate} />
        </div>
        {!imageUrl && isAdmin && (
          <div className="mt-4">
            {status === 'PENDING' ? (
              <p className="text-sm text-myth-ink-faint">Generating hero art…</p>
            ) : (
              <button
                type="button"
                onClick={handleGenerate}
                className="rounded-md border border-myth-border px-3 py-1.5 text-sm text-myth-ink-muted transition-colors hover:border-myth-border-strong hover:text-myth-ink"
              >
                {status === 'FAILED' ? 'Couldn’t generate hero art — try again' : 'Generate hero art'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
