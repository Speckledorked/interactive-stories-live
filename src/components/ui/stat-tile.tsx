// src/components/ui/stat-tile.tsx
//
// The icon-led glance tile from the lobby mockup, extracted so the
// lobby's World at a Glance row, the admin dashboard's summary boxes, and
// the analytics page stop each defining their own version.
//
// Renders as a link when `href` is set and a plain div otherwise, because
// several existing tiles genuinely have nowhere to go — making them all
// links would fake an affordance.

import React from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { CONTROL_RADIUS, FOCUS_RING, cn } from './styles'

export interface StatTileProps {
  icon: React.ComponentType<{ className?: string }>
  /** Small mono label above the value, e.g. "WEATHER". */
  label: string
  /** The value itself — kept short; this is a glance, not a paragraph. */
  value: string
  /** Optional second line, e.g. "18°C" or "View conflicts". */
  detail?: string
  href?: string
  className?: string
}

export function StatTile({ icon: Icon, label, value, detail, href, className = '' }: StatTileProps) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-myth-accent/10 text-myth-accent">
          <Icon className="h-4 w-4" />
        </span>
        <span className="truncate font-mono text-[10px] uppercase tracking-wider text-myth-ink-faint">
          {label}
        </span>
      </div>
      <p className="mt-2 text-sm leading-snug text-myth-ink">{value}</p>
      {detail && (
        <p className="mt-1 flex items-center gap-0.5 text-xs text-myth-ink-faint">
          {detail}
          {href && <ChevronRight className="h-3 w-3" />}
        </p>
      )}
    </>
  )

  const base = cn(
    'flex flex-col border border-myth-border bg-myth-surface-raised p-3.5',
    'rounded-xl',
    className
  )

  if (!href) {
    return <div className={base}>{body}</div>
  }

  return (
    <Link
      href={href}
      className={cn(
        base,
        // min-h keeps a two-line and a one-line tile the same height in a
        // grid, and clears the 44px touch floor at the same time.
        'min-h-[44px] transition-colors hover:border-myth-border-strong hover:bg-myth-surface-sunken',
        CONTROL_RADIUS,
        'rounded-xl',
        FOCUS_RING
      )}
    >
      {body}
    </Link>
  )
}
