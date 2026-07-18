// src/components/character/StatBar.tsx
// Visual stat display with progress bar

'use client'

import { useEffect, useId, useRef, useState } from 'react'

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

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-label="What this stat does"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-ember-400/50 hover:text-ember-300/80 transition-colors touch-manipulation"
      >
        ⓘ
      </button>
      {open && (
        <div
          id={popoverId}
          role="tooltip"
          className="absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 rounded-lg border border-ember-900/40 bg-tavern-900 p-3 text-xs text-ember-200/80 shadow-2xl shadow-black/50"
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
    if (val >= 2) return 'from-success-500 to-success-600'
    if (val >= 1) return 'from-ember-400 to-ember-500'
    if (val >= 0) return 'from-ember-700 to-ember-800'
    if (val >= -1) return 'from-wine-500 to-wine-600'
    return 'from-wine-700 to-wine-800'
  }

  const getTextColor = (val: number): string => {
    if (val >= 2) return 'text-success-400'
    if (val >= 1) return 'text-ember-300'
    if (val >= 0) return 'text-ember-200/70'
    if (val >= -1) return 'text-wine-400'
    return 'text-wine-300'
  }

  const percentage = getPercentage(value)
  const gradientColor = getColor(value)
  const textColor = getTextColor(value)

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium capitalize text-ember-200/70">
            {name}
          </span>
          {description && <StatInfo description={description} />}
        </div>
        <span className={`text-lg font-bold ${textColor} min-w-[3rem] text-right`}>
          {value >= 0 ? '+' : ''}{value}
        </span>
      </div>

      <div className="relative h-2 bg-black/30 rounded-full overflow-hidden border border-ember-900/30">
        <div
          className={`h-full bg-gradient-to-r ${gradientColor} transition-all duration-500 shadow-lg`}
          style={{ width: `${percentage}%` }}
        >
          <div className="w-full h-full bg-gradient-to-t from-transparent via-white/10 to-white/20" />
        </div>
      </div>
    </div>
  )
}
