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
          bgColor: 'bg-ember-900/20',
          borderColor: 'border-ember-700/40',
          textColor: 'text-ember-200',
          iconColor: 'text-ember-300'
        }
      case 'debt':
        return {
          label: '⚖️ Debt',
          bgColor: 'bg-ember-900/15',
          borderColor: 'border-ember-800/30',
          textColor: 'text-ember-200',
          iconColor: 'text-ember-400'
        }
      case 'enemy':
        return {
          label: '⚔️ Enemy',
          bgColor: 'bg-wine-800/25',
          borderColor: 'border-wine-700/40',
          textColor: 'text-wine-200',
          iconColor: 'text-wine-400'
        }
      case 'longTermThreat':
        return {
          label: '☠️ Threat',
          bgColor: 'bg-wine-800/15',
          borderColor: 'border-wine-800/30',
          textColor: 'text-wine-100',
          iconColor: 'text-wine-300'
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
            className="text-ember-400/50 hover:text-ember-200 transition-colors"
            title="Remove"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}
