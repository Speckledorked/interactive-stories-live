// src/components/character/HarmTracker.tsx
// Visual harm tracker (0-6 segments)

'use client'

import { getHarmStatus, HarmLevel } from '@/lib/game/harm'
import { AlertTriangle } from 'lucide-react'

interface HarmTrackerProps {
  current: number // Current harm (0-6)
  max?: number // Max harm (default 6)
  showLabel?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export default function HarmTracker({
  current,
  max = 6,
  showLabel = true,
  size = 'md'
}: HarmTrackerProps) {
  const segments = Array.from({ length: max }, (_, i) => i)
  const remaining = max - current

  const getSegmentColor = (index: number): string => {
    const segmentPosition = max - index

    if (segmentPosition > remaining) {
      // This segment is filled (harm taken)
      return 'bg-myth-danger/20 border-myth-danger/40'
    }

    // Remaining health - gradient from good to warn to danger
    if (remaining >= 5) return 'bg-myth-good border-myth-good/70'
    if (remaining >= 3) return 'bg-myth-warn border-myth-warn/70'
    return 'bg-myth-danger border-myth-danger/70'
  }

  // Thresholds, labels and penalty text all come from the engine now.
  //
  // This component held THREE separate copies of the harm bands: the
  // status label (>= 6 / >= 4, with its own wording, "Healthy"), the
  // warning banner's visibility (>= 4), and the warning's text (a
  // hand-written "-1 to all rolls"). getHarmStatus in lib/game/harm.ts is
  // the definition the dice and the narration actually use, and it had no
  // callers at all — so the numbers a player reads here were only
  // coincidentally the numbers being applied to their rolls. Move a band
  // in the engine and this component would have gone on reporting the old
  // one, confidently.
  const STATUS_COLORS: Record<string, string> = {
    'Taken Out': 'text-myth-danger',
    Impaired: 'text-myth-warn',
    Fine: 'text-myth-good',
  }

  const clampedHarm = Math.max(0, Math.min(6, Math.trunc(current) || 0)) as HarmLevel
  const harmStatus = getHarmStatus(clampedHarm)
  const status = {
    text: harmStatus.status,
    color: STATUS_COLORS[harmStatus.status] ?? 'text-myth-ink-muted',
  }

  const sizeClasses = {
    sm: 'h-2 gap-0.5',
    md: 'h-3 gap-1',
    lg: 'h-4 gap-1.5'
  }

  return (
    <div className="space-y-2">
      {showLabel && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-myth-ink-muted">
            Health: {remaining}/{max}
          </span>
          <span className={`font-medium ${status.color}`}>
            {status.text}
          </span>
        </div>
      )}

      <div className={`flex ${sizeClasses[size]} w-full`}>
        {segments.map((index) => (
          <div
            key={index}
            className={`
              flex-1 rounded-sm border
              ${getSegmentColor(index)}
              transition-all duration-300
              shadow-sm
            `}
          />
        ))}
      </div>

      {harmStatus.status !== 'Fine' && (
        <div className="text-xs text-myth-warn bg-myth-warn/10 border border-myth-warn/30 rounded px-2 py-1">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-[-0.15em]" />{harmStatus.description}
        </div>
      )}
    </div>
  )
}
