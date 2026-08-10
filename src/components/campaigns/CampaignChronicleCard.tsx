// A campaign rendered as a large chronicle card — artwork, title, premise,
// and a quiet meta row, with the whole card acting as the "enter this
// world" interaction. Edit/Delete are secondary: small ghost icon buttons
// floating over the art rather than full bordered buttons competing with
// the primary click target. Falls back to the same deterministic banner
// icon the old list row used when a campaign has no hero art yet (none
// generated, still generating, or generation failed).
//
// Sizing deliberately mirrors CampaignHero.tsx's proven pattern: the text
// block is normal flow and sets the card's actual height; the image is
// absolutely positioned to fill whatever that resolves to. An earlier
// version pinned a tall min-height and pushed the text to the bottom with
// mt-auto — that let the image dominate the card with the text pushed
// out of the visible area on narrow viewports. Let content drive height.

'use client'

import { Pencil, Trash2, Users, BookOpen } from 'lucide-react'
import { bannerIconFor, formatRelativeTime } from '@/lib/tavernUtils'
import { pluralize } from '@/lib/format'

export function CampaignChronicleCard({
  id,
  title,
  description,
  userRole,
  updatedAt,
  heroImageUrl,
  heroImageStatus,
  playerCount,
  sessionCount,
  deleting,
  onEnter,
  onEdit,
  onDelete,
}: {
  id: string
  title: string
  description: string
  userRole: 'ADMIN' | 'PLAYER'
  updatedAt: string
  heroImageUrl?: string | null
  heroImageStatus?: string | null
  playerCount: number
  sessionCount: number
  deleting: boolean
  onEnter: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const BannerIcon = bannerIconFor(id)
  const hasImage = heroImageStatus === 'READY' && !!heroImageUrl

  return (
    <div
      onClick={onEnter}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onEnter()
        }
      }}
      className="group relative cursor-pointer overflow-hidden rounded-lg border border-myth-border bg-myth-surface-sunken transition-colors hover:border-myth-border-strong"
    >
      {hasImage ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- no next/image remote-host config exists yet; matches CampaignHero.tsx's convention. */}
          <img src={heroImageUrl!} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-myth-canvas via-myth-canvas/75 to-myth-canvas/10" />
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <BannerIcon className="h-16 w-16 text-myth-ink-faint/40" />
        </div>
      )}

      {userRole === 'ADMIN' && (
        <div className="absolute right-3 top-3 z-10 flex gap-1.5 opacity-80 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            aria-label="Edit campaign"
            className="rounded-full border border-myth-border/70 bg-myth-canvas/70 p-1.5 text-myth-ink-muted backdrop-blur-sm transition-colors hover:border-myth-border-strong hover:text-myth-ink"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            disabled={deleting}
            aria-label="Delete campaign"
            className="rounded-full border border-myth-danger/30 bg-myth-canvas/70 p-1.5 text-myth-danger backdrop-blur-sm transition-colors hover:border-myth-danger/60 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="relative flex flex-col gap-2 px-5 py-8">
        <h3 className="font-display text-2xl font-semibold leading-tight text-myth-ink">{title}</h3>
        <p className="line-clamp-2 text-sm italic leading-relaxed text-myth-ink-muted">
          &ldquo;{description || 'A new world, waiting to be written.'}&rdquo;
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-myth-ink-faint">
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            {playerCount} {pluralize(playerCount, 'Player')}
          </span>
          <span className="flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            {sessionCount} {pluralize(sessionCount, 'Session')}
          </span>
          <span>{formatRelativeTime(updatedAt)}</span>
        </div>
      </div>
    </div>
  )
}
