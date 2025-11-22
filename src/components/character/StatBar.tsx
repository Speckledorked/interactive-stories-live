// src/components/character/StatBar.tsx
// Visual stat display with progress bar

'use client'

interface StatBarProps {
  name: string
  value: number // -2 to +3
  description?: string
}

export default function StatBar({ name, value, description }: StatBarProps) {
  // Convert -2 to +3 range to 0-100 percentage
  // -2 = 0%, 0 = 40%, +3 = 100%
  const getPercentage = (val: number): number => {
    return ((val + 2) / 5) * 100
  }

  const getColor = (val: number): string => {
    if (val >= 2) return 'from-green-500 to-green-600'
    if (val >= 1) return 'from-blue-500 to-blue-600'
    if (val >= 0) return 'from-gray-500 to-gray-600'
    if (val >= -1) return 'from-orange-500 to-orange-600'
    return 'from-red-500 to-red-600'
  }

  const getTextColor = (val: number): string => {
    if (val >= 2) return 'text-green-400'
    if (val >= 1) return 'text-blue-400'
    if (val >= 0) return 'text-gray-300'
    if (val >= -1) return 'text-orange-400'
    return 'text-red-400'
  }

  const percentage = getPercentage(value)
  const gradientColor = getColor(value)
  const textColor = getTextColor(value)

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium capitalize text-gray-300">
            {name}
          </span>
          {description && (
            <span className="text-xs text-gray-500" title={description}>
              ⓘ
            </span>
          )}
        </div>
        <span className={`text-lg font-bold ${textColor} min-w-[3rem] text-right`}>
          {value >= 0 ? '+' : ''}{value}
        </span>
      </div>

      <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden border border-gray-700">
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
