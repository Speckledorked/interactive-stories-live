// src/components/tutorial/OrientationOverlay.tsx
//
// The presentational half of the orientation: a small stack of cards with
// Back/Next, and a final "Start playing".
//
// Split from OrientationGate on purpose — the gate does auth, fetching and
// persistence, this does nothing but render what it is handed. That makes
// the copy testable without mocking a network call, which is most of what
// the tests here actually care about.

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ORIENTATION_CARDS } from '@/lib/tutorial/content/orientation'

export interface OrientationOverlayProps {
  open: boolean
  /** Called when the user finishes or dismisses. */
  onDismiss: () => void
}

export function OrientationOverlay({ open, onDismiss }: OrientationOverlayProps) {
  const [index, setIndex] = useState(0)

  const card = ORIENTATION_CARDS[index]
  const isFirst = index === 0
  const isLast = index === ORIENTATION_CARDS.length - 1

  // Guard against an empty registry rather than rendering a broken shell.
  if (!card) return null

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onDismiss() }}>
      <DialogContent hideClose className="sm:max-w-md">
        <div className="p-5">
          {/* Progress dots. Decorative — the real position is announced
              in the heading's sr-only counter below, so a screen reader
              gets the count without parsing a row of divs. */}
          <div className="mb-5 flex items-center gap-1.5" aria-hidden>
            {ORIENTATION_CARDS.map((c, i) => (
              <div
                key={c.id}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= index ? 'bg-myth-accent' : 'bg-myth-surface-sunken'
                }`}
              />
            ))}
          </div>

          <DialogTitle className="text-xl">
            {card.title}
            <span className="sr-only">
              {` (step ${index + 1} of ${ORIENTATION_CARDS.length})`}
            </span>
          </DialogTitle>

          <div className="mt-3 space-y-3">
            {card.body.map((paragraph, i) => (
              <p key={i} className="text-sm leading-relaxed text-myth-ink-muted">
                {paragraph}
              </p>
            ))}
          </div>

          {card.learnMore && (
            <Link
              href={`/help/${card.learnMore}`}
              onClick={onDismiss}
              className="mt-4 inline-flex min-h-[44px] items-center text-sm font-medium text-myth-accent underline underline-offset-4 hover:text-myth-ink"
            >
              Read more about this
            </Link>
          )}
        </div>

        {/* Stacked on mobile so the primary action sits nearest the thumb;
            inline from sm up. Mirrors DialogFooter's own shape. */}
        <div className="flex flex-col-reverse gap-2 p-5 pt-0 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="ghost" onClick={onDismiss}>
            Skip
          </Button>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            {!isFirst && (
              <Button variant="secondary" onClick={() => setIndex((i) => i - 1)}>
                Back
              </Button>
            )}
            {isLast ? (
              <Button onClick={onDismiss}>Start playing</Button>
            ) : (
              <Button onClick={() => setIndex((i) => i + 1)}>Next</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
