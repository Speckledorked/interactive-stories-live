// src/components/scene/EntityStubModal.tsx
// A small "stub" popover for a clock or timeline event clicked from the
// story page sidebar — the story page already has all the data (both
// ActiveClocksPanel's clocks and RecentTimelinePanel's timeline come
// fully loaded from the campaign GET, not a stub fetch), so this is a
// pure presentational overlay, never its own data round-trip. A bottom
// sheet on mobile (items-end), a centered modal at sm: and up, matching
// this app's mobile-first convention (see docs/design-system.md).

'use client'

import Link from 'next/link'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { IconButton } from '@/components/ui/icon-button'
import { X } from 'lucide-react'

export interface EntityStubModalProps {
  isOpen: boolean
  onClose: () => void
  eyebrow?: string
  title: string
  meta?: string
  body: string
  footerLinkHref?: string
  footerLinkLabel?: string
}

export function EntityStubModal({
  isOpen,
  onClose,
  eyebrow,
  title,
  meta,
  body,
  footerLinkHref,
  footerLinkLabel,
}: EntityStubModalProps) {
  useEscapeKey(onClose, isOpen)

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-myth-surface-raised border border-myth-border rounded-t-lg sm:rounded-lg shadow-2xl shadow-black/50 max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-myth-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-xs font-mono uppercase tracking-wider text-myth-ink-faint mb-1">{eyebrow}</p>
            )}
            <h2 className="font-display text-lg text-myth-ink">{title}</h2>
            {meta && <p className="text-xs text-myth-ink-muted mt-1">{meta}</p>}
          </div>
          <IconButton icon={X} label="Close" className="flex-shrink-0" onClick={onClose} />
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm leading-relaxed text-myth-ink-muted whitespace-pre-wrap">{body}</p>
        </div>

        {footerLinkHref && (
          <div className="px-5 py-3 border-t border-myth-border">
            <Link href={footerLinkHref} className="text-sm text-myth-accent hover:underline">
              {footerLinkLabel || 'View in wiki'}
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
