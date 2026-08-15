// src/components/ui/timeline.tsx
//
// The dotted-rail list from the mockups — used by the story page's
// Resolutions, the lobby's Recent Events, and the World Timeline, all of
// which currently hand-roll their own version of "a vertical list with
// markers and a trailing turn number".
//
// The rail is drawn with a border on the item rather than an absolutely
// positioned line, so it can't desynchronise from the content height when
// an item wraps to two lines on a narrow screen.

import React from 'react'
import { cn } from './styles'

export type TimelineMarkerTone = 'accent' | 'muted' | 'good' | 'danger'

const MARKER_TONES: Record<TimelineMarkerTone, string> = {
  accent: 'border-myth-accent bg-myth-accent',
  muted: 'border-myth-border-strong bg-myth-surface',
  good: 'border-myth-good bg-myth-good',
  danger: 'border-myth-danger bg-myth-danger',
}

export function Timeline({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <ol className={cn('relative', className)}>{children}</ol>
}

export interface TimelineItemProps {
  /** Rendered at the end of the header row, e.g. "Turn 4". */
  meta?: React.ReactNode
  tone?: TimelineMarkerTone
  /** Drops the connecting rail below this item — pass on the last one. */
  isLast?: boolean
  /** Optional icon inside the marker instead of a plain dot. */
  icon?: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  className?: string
}

export function TimelineItem({
  meta,
  tone = 'muted',
  isLast = false,
  icon: Icon,
  children,
  className = '',
}: TimelineItemProps) {
  return (
    <li className={cn('relative flex gap-3', className)}>
      <div className="flex flex-col items-center">
        <span
          aria-hidden
          className={cn(
            'mt-1.5 flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-full border-2',
            MARKER_TONES[tone]
          )}
        >
          {Icon && <Icon className="h-2 w-2 text-myth-accent-ink" />}
        </span>
        {!isLast && <span aria-hidden className="w-px flex-1 bg-myth-border" />}
      </div>
      <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-4')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">{children}</div>
          {meta && (
            <span className="flex-shrink-0 font-mono text-xs tabular-nums text-myth-ink-faint">{meta}</span>
          )}
        </div>
      </div>
    </li>
  )
}
