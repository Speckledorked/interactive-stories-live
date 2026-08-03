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
          bgColor: 'bg-myth-good/10',
          borderColor: 'border-myth-good/30',
          textColor: 'text-myth-ink',
          iconColor: 'text-myth-good'
        }
      case 'debt':
        return {
          label: '⚖️ Debt',
          bgColor: 'bg-myth-warn/10',
          borderColor: 'border-myth-warn/30',
          textColor: 'text-myth-ink',
          iconColor: 'text-myth-warn'
        }
      case 'enemy':
        return {
          label: '⚔️ Enemy',
          bgColor: 'bg-myth-danger/10',
          borderColor: 'border-myth-danger/30',
          textColor: 'text-myth-danger',
          iconColor: 'text-myth-danger'
        }
      case 'longTermThreat':
        return {
          label: '☠️ Threat',
          bgColor: 'bg-myth-danger/10',
          borderColor: 'border-myth-danger/20',
          textColor: 'text-myth-danger',
          iconColor: 'text-myth-danger'
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
            className="text-myth-ink-faint hover:text-myth-ink transition-colors"
            title="Remove"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}
