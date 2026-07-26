// src/components/character/HarmTracker.tsx
// Visual harm tracker (0-6 segments)

'use client'

import { getHarmStatus, HarmLevel } from '@/lib/game/harm'

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
      return 'bg-wine-600/30 border-wine-600/50'
    }

    // Remaining health - gradient from green to yellow
    if (remaining >= 5) return 'bg-success-500 border-success-400'
    if (remaining >= 3) return 'bg-ember-500 border-ember-400'
    return 'bg-wine-500 border-wine-400'
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
    'Taken Out': 'text-wine-400',
    Impaired: 'text-ember-400',
    Fine: 'text-success-400',
  }

  const clampedHarm = Math.max(0, Math.min(6, Math.trunc(current) || 0)) as HarmLevel
  const harmStatus = getHarmStatus(clampedHarm)
  const status = {
    text: harmStatus.status,
    color: STATUS_COLORS[harmStatus.status] ?? 'text-ember-300',
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
          <span className="text-ember-300/60">
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
        <div className="text-xs text-ember-400 bg-ember-900/15 border border-ember-700/30 rounded px-2 py-1">
          ⚠️ {harmStatus.description}
        </div>
      )}
    </div>
  )
}
