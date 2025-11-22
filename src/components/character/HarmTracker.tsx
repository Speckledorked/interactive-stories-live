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
      return 'bg-red-500/30 border-red-500/50'
    }

    // Remaining health - gradient from green to yellow
    if (remaining >= 5) return 'bg-green-500 border-green-400'
    if (remaining >= 3) return 'bg-yellow-500 border-yellow-400'
    return 'bg-orange-500 border-orange-400'
  }

  const getStatusText = (): { text: string; color: string } => {
    if (current >= 6) return { text: 'Taken Out', color: 'text-red-400' }
    if (current >= 4) return { text: 'Impaired', color: 'text-orange-400' }
    return { text: 'Healthy', color: 'text-green-400' }
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
          <span className="text-gray-400">
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
        <div className="text-xs text-orange-400 bg-orange-500/10 border border-orange-500/30 rounded px-2 py-1">
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
