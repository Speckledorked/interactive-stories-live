// src/components/character/HarmTracker.tsx
// Visual harm tracker (0-6 segments)

'use client'

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

  const getStatusText = (): { text: string; color: string } => {
    if (current >= 6) return { text: 'Taken Out', color: 'text-wine-400' }
    if (current >= 4) return { text: 'Impaired', color: 'text-ember-400' }
    return { text: 'Healthy', color: 'text-success-400' }
  }

  const sizeClasses = {
    sm: 'h-2 gap-0.5',
    md: 'h-3 gap-1',
    lg: 'h-4 gap-1.5'
  }

  const status = getStatusText()

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

      {current >= 4 && (
        <div className="text-xs text-ember-400 bg-ember-900/15 border border-ember-700/30 rounded px-2 py-1">
          {current >= 6 ? (
            '⚠️ Character is unconscious, captured, or dying'
          ) : (
            '⚠️ -1 to all rolls while impaired'
          )}
        </div>
      )}
    </div>
  )
}
