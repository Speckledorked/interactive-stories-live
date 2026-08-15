// src/components/ui/badge.tsx
//
// Keeps the semantic variant set (which was already myth-native and is
// used across the admin panels) and drops the four dead legacy variants
// that were still wine/ember. Adds the three status variants the story
// page's scene list needs — AWAITING / COMPLETE / LOCKED.
//
// All variants share one shape: a low-opacity tint of a single semantic
// colour plus full-opacity text of that same colour.

import React from 'react'
import { cn } from './styles'

export type BadgeVariant =
  // Fog-of-war / visibility
  | 'gmOnly'
  | 'visible'
  | 'public'
  // Guidance
  | 'advanced'
  | 'recommended'
  | 'dangerous'
  | 'optional'
  // Scene/job lifecycle
  | 'awaiting'
  | 'complete'
  | 'locked'
  | 'failed'
  // Neutral default
  | 'neutral'

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  /** Optional leading icon — a lucide component, never an emoji. */
  icon?: React.ComponentType<{ className?: string }>
}

const VARIANTS: Record<BadgeVariant, string> = {
  gmOnly: 'bg-myth-info/10 text-myth-info',
  visible: 'bg-myth-good/10 text-myth-good',
  public: 'bg-myth-accent/10 text-myth-accent',
  advanced: 'bg-myth-info/10 text-myth-info',
  recommended: 'bg-myth-good/10 text-myth-good',
  dangerous: 'bg-myth-danger/10 text-myth-danger',
  optional: 'bg-myth-ink/5 text-myth-ink-muted',
  awaiting: 'bg-myth-good/10 text-myth-good',
  complete: 'bg-myth-ink/5 text-myth-ink-muted',
  locked: 'bg-myth-ink/5 text-myth-ink-faint',
  failed: 'bg-myth-danger/10 text-myth-danger',
  neutral: 'bg-myth-surface-sunken text-myth-ink-muted',
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className = '', variant = 'neutral', icon: Icon, children, ...props },
  ref
) {
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider',
        VARIANTS[variant],
        className
      )}
      {...props}
    >
      {Icon && <Icon className="h-3 w-3 flex-shrink-0" />}
      {children}
    </span>
  )
})
