// src/components/ui/progress.tsx
//
// Rewritten from the ember-gradient version onto myth tokens, and given
// the ARIA a bare pair of divs never had. `tone` exists because this is
// used for two different things — neutral progress (a clock filling, a
// world turn banking hours) and semantic state (a faction's stability,
// where low is bad) — and those shouldn't look identical.

import React from 'react'
import { cn } from './styles'

export type ProgressTone = 'accent' | 'good' | 'warn' | 'danger' | 'neutral'

export interface ProgressProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  value?: number
  max?: number
  tone?: ProgressTone
  /** Accessible name, e.g. "Stability". Falls back to a generic label. */
  label?: string
  /** Bar thickness. `sm` for inline meters in a dense card. */
  size?: 'sm' | 'md'
}

const TONES: Record<ProgressTone, string> = {
  accent: 'bg-myth-accent',
  good: 'bg-myth-good',
  warn: 'bg-myth-warn',
  danger: 'bg-myth-danger',
  neutral: 'bg-myth-ink-faint',
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(function Progress(
  { className = '', value = 0, max = 100, tone = 'accent', label, size = 'md', ...props },
  ref
) {
  const safeMax = max > 0 ? max : 100
  const pct = Math.min(Math.max((value / safeMax) * 100, 0), 100)

  return (
    <div
      ref={ref}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-label={label ?? 'Progress'}
      className={cn(
        'relative w-full overflow-hidden rounded-full bg-myth-surface-sunken',
        size === 'sm' ? 'h-1.5' : 'h-2.5',
        className
      )}
      {...props}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-300 ease-out', TONES[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
})
