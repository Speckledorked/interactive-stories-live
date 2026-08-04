// Left-aligned page hero for the campaign lobby: big display-serif title,
// a single italic log-line instead of a paragraph, the primary entry CTA,
// and Universe/Turn/Date collapsed into one row of tabular-mono chips.
// Absorbs what used to be a separate CampaignEntryCTA card below the hero
// — title, subtitle, and the primary action now read as one cohesive
// block instead of two visually separate pieces.
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
import { CampaignEntryCTA } from './CampaignEntryCTA'

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
  hasCharacter,
  onCreateCharacter,
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
  hasCharacter: boolean
  onCreateCharacter: () => void
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
        // Gave up without ever seeing READY/FAILED — leaving `status` stuck
        // on PENDING would show "Generating…" forever with no way to retry.
        setStatus('FAILED')
      }
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [status, campaignId])

  const handleGenerate = async () => {
    setStatus('PENDING')
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/hero-image`, { method: 'POST' })
      if (!response.ok) {
        setStatus('FAILED')
      }
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
        <h1 className="font-display text-4xl font-semibold leading-tight text-myth-ink sm:text-6xl">{title}</h1>
        {description && <p className="mt-3 italic text-myth-ink-muted">{description}</p>}
        <CampaignEntryCTA campaignId={campaignId} hasCharacter={hasCharacter} onCreateCharacter={onCreateCharacter} />
        <div className="mt-5 flex flex-wrap items-center gap-2">
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
