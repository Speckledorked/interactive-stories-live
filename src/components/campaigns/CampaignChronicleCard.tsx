// A campaign rendered as a large chronicle card — artwork, a sigil badge,
// title, premise, a divider, and a quiet meta row closing on a chevron,
// with the whole card acting as the "enter this world" interaction.
// Edit/Delete are secondary: small ghost icon buttons floating over the
// art rather than full bordered buttons competing with the primary click
// target. Falls back to the same deterministic banner icon the old list
// row used when a campaign has no hero art yet (none generated, still
// generating, or generation failed).
//
// The sigil and the no-art watermark are the SAME icon, from
// bannerIconFor(id) — one emblem per campaign, shown small and always,
// or large and faded when there's no art to look at instead.
//
// Sizing deliberately mirrors CampaignHero.tsx's proven pattern: the text
// block is normal flow and sets the card's actual height; the image is
// absolutely positioned to fill whatever that resolves to. An earlier
// version pinned a tall min-height and pushed the text to the bottom with
// mt-auto — that let the image dominate the card with the text pushed
// out of the visible area on narrow viewports. Let content drive height.

'use client'

import { Pencil, Trash2, Users, BookOpen, ChevronRight } from 'lucide-react'
import { bannerIconFor, formatRelativeTime } from '@/lib/tavernUtils'
import { pluralize } from '@/lib/format'
import { IconButton } from '@/components/ui/icon-button'

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
      {/* With no hero art the emblem becomes a heraldic device bled off
          the card's right edge, rather than a centred watermark. Centred,
          it sat directly behind the title and premise and measurably hurt
          their legibility — and now that the sigil badge carries the same
          emblem beside the title, a second full-strength copy in the
          text's way was redundant as well as harmful. */}
      {hasImage ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- no next/image remote-host config exists yet; matches CampaignHero.tsx's convention. */}
          <img src={heroImageUrl!} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-myth-canvas via-myth-canvas/75 to-myth-canvas/10" />
        </>
      ) : (
        <div aria-hidden className="pointer-events-none absolute -right-6 top-1/2 -translate-y-1/2">
          <BannerIcon className="h-28 w-28 text-myth-ink-faint/15" />
        </div>
      )}

      {userRole === 'ADMIN' && (
        <div className="absolute right-3 top-3 z-10 flex gap-2 opacity-80 transition-opacity group-hover:opacity-100">
          <IconButton
            icon={Pencil}
            label="Edit campaign"
            size="sm"
            className="border border-myth-border/70 bg-myth-canvas/70 backdrop-blur-sm hover:border-myth-border-strong"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
          />
          <IconButton
            icon={Trash2}
            label="Delete campaign"
            size="sm"
            variant="danger"
            className="border border-myth-border/70 bg-myth-canvas/70 backdrop-blur-sm hover:border-myth-danger"
            disabled={deleting}
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          />
        </div>
      )}

      <div className="relative flex flex-col gap-2 px-5 py-8">
        {/* Sigil + title. The sigil is the same deterministic per-campaign
            emblem used as the no-art watermark behind this card, promoted
            to a wax-seal badge so a campaign is identifiable at a glance
            in a grid even once it HAS art (the watermark hides then).
            min-w-0 + break-words on the title because a long unbroken
            campaign name is the realistic overflow case in a 2-up grid
            at 390px, and the sigil must not be what gets squeezed. */}
        {/* pr-[5.5rem] for admins reserves the width of the two floating
            Edit/Delete buttons, which are absolutely positioned in this
            same top-right corner. Without it a title long enough to wrap
            ran straight under them. */}
        <div className={`flex items-start gap-3 ${userRole === 'ADMIN' ? 'pr-[5.5rem]' : ''}`}>
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-myth-gold/40 bg-myth-canvas/70 text-myth-gold backdrop-blur-sm"
          >
            <BannerIcon className="h-4 w-4" />
          </span>
          <h3 className="min-w-0 break-words font-display text-2xl font-semibold leading-tight text-myth-ink">
            {title}
          </h3>
        </div>

        <p className="line-clamp-2 text-sm italic leading-relaxed text-myth-ink-muted">
          &ldquo;{description || 'A new world, waiting to be written.'}&rdquo;
        </p>

        {/* Hairline rule separating the world's identity from its
            bookkeeping — the mockup's divider. */}
        <div className="mt-2 h-px w-full bg-myth-border" />

        <div className="flex items-center gap-3 text-xs text-myth-ink-faint">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
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
          {/* Enter affordance. Deliberately decorative and aria-hidden:
              the card itself is the button, so a second focusable control
              here would add a tap target that does the same thing and
              sits inside another one. It slides on hover/focus-within so
              the whole card reads as the interaction. */}
          <ChevronRight
            aria-hidden
            className="ml-auto h-4 w-4 flex-shrink-0 text-myth-ink-faint transition-transform group-hover:translate-x-0.5 group-focus-within:translate-x-0.5"
          />
        </div>
      </div>
    </div>
  )
}
