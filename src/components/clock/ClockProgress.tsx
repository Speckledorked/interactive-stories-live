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
    if (percentage >= 90) return { stroke: '#ef4444', glow: 'shadow-danger-500/50', bg: 'from-wine-800/30 to-wine-800/20' }
    if (percentage >= 75) return { stroke: '#f59e0b', glow: 'shadow-warning-500/50', bg: 'from-ember-900/30 to-ember-800/20' }
    if (percentage >= 50) return { stroke: '#c99a3a', glow: 'shadow-ember-500/40', bg: 'from-ember-900/20 to-ember-900/10' }
    return { stroke: '#855f24', glow: 'shadow-black/30', bg: 'from-tavern-800/40 to-tavern-900/30' }
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
    <div className={`rounded-xl bg-gradient-to-br ${colors.bg} border border-ember-900/30 hover:border-ember-700/40 shadow-lg shadow-black/30 p-5 transition-all`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className={`font-bold text-ember-100 ${size === 'sm' ? 'text-sm' : 'text-lg'} flex items-center gap-2`}>
            ⏰ {name}
            {isHidden && (
              <span className="text-xs bg-black/30 text-ember-400/60 px-2 py-0.5 rounded">Hidden</span>
            )}
          </h3>
          {description && (
            <p className="text-xs text-ember-300/50 mt-1">{description}</p>
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
              stroke="#3d2c15"
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
            <div className={`font-bold text-ember-100 ${config.text}`}>
              {current}/{max}
            </div>
            <div className="text-xs text-ember-400/50">ticks</div>
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
                : 'bg-black/30'
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
            ? 'bg-wine-800/20 border-wine-700/40'
            : 'bg-black/25 border-ember-900/30'
        }`}>
          <p className="text-xs font-semibold text-ember-400/60 mb-1">When Complete:</p>
          <p className={`text-sm ${percentage >= 90 ? 'text-wine-300' : 'text-ember-200/70'}`}>
            {consequence}
          </p>
        </div>
      )}

      {/* Action button (admin only) */}
      {onTick && current < max && (
        <button
          onClick={onTick}
          className="w-full mt-4 px-4 py-2 bg-wine-600 hover:bg-wine-500 text-ember-100 rounded-lg transition-colors font-medium text-sm"
        >
          + Advance Clock
        </button>
      )}

      {/* Completion badge */}
      {current >= max && (
        <div className="mt-4 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-wine-800/30 border border-wine-600/50 rounded-lg text-wine-400 font-bold">
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
    <div className="flex items-center gap-3 p-2 rounded hover:bg-black/25 transition-colors">
      <div className="relative w-12 h-12 flex-shrink-0">
        <svg className="transform -rotate-90" width="48" height="48">
          <circle cx="24" cy="24" r="20" stroke="#3d2c15" strokeWidth="4" fill="none" />
          <circle
            cx="24"
            cy="24"
            r="20"
            stroke={percentage >= 75 ? '#ef4444' : '#c99a3a'}
            strokeWidth="4"
            fill="none"
            strokeDasharray={2 * Math.PI * 20}
            strokeDashoffset={2 * Math.PI * 20 - (percentage / 100) * 2 * Math.PI * 20}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-ember-100">
          {current}/{max}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ember-100 truncate">{name}</p>
        <p className="text-xs text-ember-400/50">{percentage.toFixed(0)}% complete</p>
      </div>
    </div>
  )
}
