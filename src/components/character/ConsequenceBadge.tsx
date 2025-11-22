// src/components/character/ConsequenceBadge.tsx
// Visual badge for consequences (debts, promises, enemies, threats)

'use client'

interface ConsequenceBadgeProps {
  type: 'promise' | 'debt' | 'enemy' | 'longTermThreat'
  description: string
  onRemove?: () => void
}

export default function ConsequenceBadge({ type, description, onRemove }: ConsequenceBadgeProps) {
  const getTypeConfig = () => {
    switch (type) {
      case 'promise':
        return {
          label: '🤝 Promise',
          bgColor: 'bg-blue-900/30',
          borderColor: 'border-blue-700',
          textColor: 'text-blue-200',
          iconColor: 'text-blue-400'
        }
      case 'debt':
        return {
          label: '⚖️ Debt',
          bgColor: 'bg-yellow-900/30',
          borderColor: 'border-yellow-700',
          textColor: 'text-yellow-200',
          iconColor: 'text-yellow-400'
        }
      case 'enemy':
        return {
          label: '⚔️ Enemy',
          bgColor: 'bg-red-900/30',
          borderColor: 'border-red-700',
          textColor: 'text-red-200',
          iconColor: 'text-red-400'
        }
      case 'longTermThreat':
        return {
          label: '☠️ Threat',
          bgColor: 'bg-purple-900/30',
          borderColor: 'border-purple-700',
          textColor: 'text-purple-200',
          iconColor: 'text-purple-400'
        }
    }
  }

  const config = getTypeConfig()

  return (
    <div
      className={`
        ${config.bgColor} ${config.borderColor}
        border rounded-lg p-3
        transition-all duration-200
        hover:shadow-lg hover:scale-[1.02]
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className={`text-xs font-semibold ${config.iconColor} mb-1`}>
            {config.label}
          </div>
          <p className={`text-sm ${config.textColor}`}>
            {description}
          </p>
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            title="Remove"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}
