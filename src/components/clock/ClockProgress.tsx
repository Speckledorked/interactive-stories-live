// src/components/clock/ClockProgress.tsx
// Circular progress visualization for GM clocks

'use client'

interface ClockProgressProps {
  name: string
  current: number
  max: number
  description?: string
  consequence?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  isHidden?: boolean
  onTick?: () => void
}

export default function ClockProgress({
  name,
  current,
  max,
  description,
  consequence,
  size = 'md',
  isHidden = false,
  onTick
}: ClockProgressProps) {
  const percentage = (current / max) * 100
  const circumference = 2 * Math.PI * 45 // radius = 45

  // Calculate stroke dash offset for circular progress
  const strokeDashoffset = circumference - (percentage / 100) * circumference

  // Get color based on progress
  const getColor = () => {
    if (percentage >= 90) return { stroke: '#ef4444', glow: 'shadow-red-500/50', bg: 'from-red-900/30 to-red-800/20' }
    if (percentage >= 75) return { stroke: '#f97316', glow: 'shadow-orange-500/50', bg: 'from-orange-900/30 to-orange-800/20' }
    if (percentage >= 50) return { stroke: '#eab308', glow: 'shadow-yellow-500/50', bg: 'from-yellow-900/30 to-yellow-800/20' }
    return { stroke: '#3b82f6', glow: 'shadow-blue-500/50', bg: 'from-blue-900/30 to-blue-800/20' }
  }

  const sizeClasses = {
    sm: { circle: 80, text: 'text-xs', label: 'text-sm', container: 'w-20 h-20' },
    md: { circle: 120, text: 'text-sm', label: 'text-base', container: 'w-32 h-32' },
    lg: { circle: 160, text: 'text-lg', label: 'text-xl', container: 'w-40 h-40' },
    xl: { circle: 200, text: 'text-2xl', label: 'text-3xl', container: 'w-52 h-52' }
  }

  const config = sizeClasses[size]
  const colors = getColor()

  return (
    <div className={`card bg-gradient-to-br ${colors.bg} border-gray-700 hover:border-gray-600 transition-all`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className={`font-bold text-white ${size === 'sm' ? 'text-sm' : 'text-lg'} flex items-center gap-2`}>
            ⏰ {name}
            {isHidden && (
              <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded">Hidden</span>
            )}
          </h3>
          {description && (
            <p className="text-xs text-gray-400 mt-1">{description}</p>
          )}
        </div>
      </div>

      {/* Circular Progress */}
      <div className="flex items-center justify-center mb-4">
        <div className={`relative ${config.container}`}>
          {/* Background circle */}
          <svg className="transform -rotate-90" width={config.circle} height={config.circle}>
            <circle
              cx={config.circle / 2}
              cy={config.circle / 2}
              r="45"
              stroke="#374151"
              strokeWidth="8"
              fill="none"
            />
            {/* Progress circle */}
            <circle
              cx={config.circle / 2}
              cy={config.circle / 2}
              r="45"
              stroke={colors.stroke}
              strokeWidth="8"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="transition-all duration-500"
              style={{ filter: 'drop-shadow(0 0 8px currentColor)' }}
            />
          </svg>

          {/* Center content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className={`font-bold text-white ${config.text}`}>
              {current}/{max}
            </div>
            <div className="text-xs text-gray-400">ticks</div>
          </div>

          {/* Pulsing effect when near completion */}
          {percentage >= 75 && (
            <div className={`absolute inset-0 rounded-full bg-${colors.stroke}/10 animate-ping`} />
          )}
        </div>
      </div>

      {/* Tick markers */}
      <div className="flex justify-center gap-1 mb-4">
        {Array.from({ length: max }, (_, i) => (
          <div
            key={i}
            className={`
              h-2 flex-1 rounded-full transition-all duration-300
              ${i < current
                ? 'bg-gradient-to-r from-current to-current'
                : 'bg-gray-700'
              }
            `}
            style={{ color: i < current ? colors.stroke : undefined }}
          />
        ))}
      </div>

      {/* Consequence */}
      {consequence && (
        <div className={`p-3 rounded-lg border ${
          percentage >= 90
            ? 'bg-red-900/20 border-red-700/50'
            : 'bg-gray-800/50 border-gray-700'
        }`}>
          <p className="text-xs font-semibold text-gray-400 mb-1">When Complete:</p>
          <p className={`text-sm ${percentage >= 90 ? 'text-red-300' : 'text-gray-300'}`}>
            {consequence}
          </p>
        </div>
      )}

      {/* Action button (admin only) */}
      {onTick && current < max && (
        <button
          onClick={onTick}
          className="w-full mt-4 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors font-medium text-sm"
        >
          + Advance Clock
        </button>
      )}

      {/* Completion badge */}
      {current >= max && (
        <div className="mt-4 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-500/20 border border-red-500 rounded-lg text-red-400 font-bold">
            ⚠️ COMPLETE
          </div>
        </div>
      )}
    </div>
  )
}

// Compact version for lists
export function CompactClock({ name, current, max }: { name: string, current: number, max: number }) {
  const percentage = (current / max) * 100

  return (
    <div className="flex items-center gap-3 p-2 rounded hover:bg-gray-800 transition-colors">
      <div className="relative w-12 h-12 flex-shrink-0">
        <svg className="transform -rotate-90" width="48" height="48">
          <circle cx="24" cy="24" r="20" stroke="#374151" strokeWidth="4" fill="none" />
          <circle
            cx="24"
            cy="24"
            r="20"
            stroke={percentage >= 75 ? '#ef4444' : '#3b82f6'}
            strokeWidth="4"
            fill="none"
            strokeDasharray={2 * Math.PI * 20}
            strokeDashoffset={2 * Math.PI * 20 - (percentage / 100) * 2 * Math.PI * 20}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
          {current}/{max}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{name}</p>
        <p className="text-xs text-gray-500">{percentage.toFixed(0)}% complete</p>
      </div>
    </div>
  )
}
