// src/components/ui/spinner.tsx
//
// Replaces globals.css's `.spinner` component class, which was
// `border-ember-400` — an old-palette colour that rendered the same
// regardless of theme. This one inherits the current text colour, so a
// spinner inside a primary button is legible on the accent fill and a
// spinner on a page is legible on the canvas, with no per-call-site
// colour handling.

import React from 'react'
import { cn } from './styles'

export function Spinner({ className = 'h-5 w-5', label }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Loading'}
      className={cn(
        'inline-block animate-spin rounded-full border-2 border-current border-t-transparent align-[-0.125em]',
        className
      )}
    />
  )
}

/** Centred spinner for a whole-page or whole-panel loading state. */
export function SpinnerBlock({ className = 'h-8 w-8', label }: { className?: string; label?: string }) {
  return (
    <div className="flex justify-center py-16 text-myth-ink-faint">
      <Spinner className={className} label={label} />
    </div>
  )
}
