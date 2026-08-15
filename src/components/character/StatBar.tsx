// src/components/character/StatBar.tsx
// Visual stat display with progress bar

'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { Button } from '@/components/ui/button'

interface StatBarProps {
  name: string
  value: number // -2 to +3
  description?: string
}

// The info affordance used to be a bare `title="..."` attribute, which
// only shows on hover — dead weight on mobile, where there's no hover and
// tapping it did nothing. This makes it a real tap/click target with a
// popover, closing on Escape or an outside tap.
function StatInfo({ description }: { description: string }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const popoverId = useId()

  useEscapeKey(() => setOpen(false), open)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative inline-flex">
      <Button
        variant="ghost" size="sm"
        type="button"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-label="What this stat does"
        onClick={() => setOpen((v) => !v)}
      >
        ⓘ
      </Button>
      {open && (
        <div
          id={popoverId}
          role="tooltip"
          className="absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 rounded-lg border border-myth-border bg-myth-surface-raised p-3 text-xs text-myth-ink-muted shadow-2xl shadow-black/50"
        >
          {description}
        </div>
      )}
    </div>
  )
}

export default function StatBar({ name, value, description }: StatBarProps) {
  // Convert -2 to +3 range to 0-100 percentage
  // -2 = 0%, 0 = 40%, +3 = 100%
  const getPercentage = (val: number): number => {
    return ((val + 2) / 5) * 100
  }

  const getColor = (val: number): string => {
    if (val >= 2) return 'bg-myth-good'
    if (val >= 1) return 'bg-myth-ink-muted'
    if (val >= 0) return 'bg-myth-ink-faint'
    if (val >= -1) return 'bg-myth-warn'
    return 'bg-myth-danger'
  }

  const getTextColor = (val: number): string => {
    if (val >= 2) return 'text-myth-good'
    if (val >= 1) return 'text-myth-ink'
    if (val >= 0) return 'text-myth-ink-muted'
    if (val >= -1) return 'text-myth-warn'
    return 'text-myth-danger'
  }

  const percentage = getPercentage(value)
  const fillColor = getColor(value)
  const textColor = getTextColor(value)

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium capitalize text-myth-ink-muted">
            {name}
          </span>
          {description && <StatInfo description={description} />}
        </div>
        <span className={`text-lg font-bold ${textColor} min-w-[3rem] text-right`}>
          {value >= 0 ? '+' : ''}{value}
        </span>
      </div>

      <div className="relative h-2 bg-myth-surface-sunken rounded-full overflow-hidden border border-myth-border">
        <div
          className={`h-full ${fillColor} transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
