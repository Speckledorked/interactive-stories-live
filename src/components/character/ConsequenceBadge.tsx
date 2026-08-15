// src/components/character/ConsequenceBadge.tsx
// Visual badge for consequences (debts, promises, enemies, threats)

'use client'

import { IconButton } from '@/components/ui/icon-button'
import { X } from 'lucide-react'

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
        // #292: this reads from Character.consequences.debts, a freeform
        // string array — historically written by the AI GM before that
        // path was aliased into the real, mechanically-live Debt model
        // (see lib/game/debts.ts), and still written today only by the
        // character-creation form's own "Debts Owed" flavor-text field.
        // Neither source is linked to Debt.status, so an entry here can
        // never be marked resolved and may already have been settled (or
        // never existed as a real Debt) — labeled and noted distinctly
        // from "⚖️" so it doesn't read as the tracked economy shown in
        // the Obligations section above.
        return {
          label: '📝 Noted Debt',
          bgColor: 'bg-myth-warn/10',
          borderColor: 'border-myth-warn/30',
          textColor: 'text-myth-ink',
          iconColor: 'text-myth-warn',
          note: 'Informal note — not linked to the tracked Debt economy above.',
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
          {config.note && (
            <p className="mt-1 text-[11px] italic text-myth-ink-faint">{config.note}</p>
          )}
        </div>
        {onRemove && (
          <IconButton icon={X} label="Remove" size="sm" onClick={onRemove} />
        )}
      </div>
    </div>
  )
}
