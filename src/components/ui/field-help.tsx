'use client'

import React, { useEffect, useId, useRef, useState } from 'react'

export interface FieldHelpProps {
  /** What the control does. */
  what: string
  /** Who is affected by changing it. */
  whoItAffects?: string
  /** When someone would reach for it. */
  whenToUse?: string
  className?: string
}

// Small (?) affordance next to a label. Opens a short popover on click,
// closes on Escape, outside click, or blur past the popover.
export function FieldHelp({ what, whoItAffects, whenToUse, className = '' }: FieldHelpProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const popoverId = useId()

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-label="Help for this field"
        onClick={() => setOpen((value) => !value)}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-myth-border text-[10px] leading-none text-myth-ink-faint transition-colors hover:border-myth-border-strong hover:text-myth-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-myth-accent"
      >
        ?
      </button>
      {open && (
        <div
          id={popoverId}
          role="tooltip"
          className="absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 rounded-md border border-myth-border bg-myth-surface-raised p-3 text-xs shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.12)]"
        >
          <p className="text-myth-ink">{what}</p>
          {whoItAffects && (
            <p className="mt-1.5 text-myth-ink-muted">
              <span className="font-medium text-myth-ink-muted">Affects: </span>
              {whoItAffects}
            </p>
          )}
          {whenToUse && (
            <p className="mt-1.5 text-myth-ink-muted">
              <span className="font-medium text-myth-ink-muted">Use it when: </span>
              {whenToUse}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
