// src/components/character/ConsequenceBadge.tsx
// Visual badge for consequences (debts, promises, enemies, threats)

'use client'

import { IconButton } from '@/components/ui/icon-button'
import { X } from 'lucide-react'
import { CONSEQUENCE_ICONS } from '@/lib/ui/icons'
import { CONSEQUENCE_LABELS, type ConsequenceType } from '@/lib/game/consequenceLabels'

interface ConsequenceBadgeProps {
  type: ConsequenceType
  description: string
  onRemove?: () => void
}

export default function ConsequenceBadge({ type, description, onRemove }: ConsequenceBadgeProps) {
  const getTypeConfig = () => {
    switch (type) {
      case 'promise':
        return {
          ...CONSEQUENCE_LABELS.promise,
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
        // never existed as a real Debt) — labelled and annotated so it
        // doesn't read as the tracked economy shown in the Obligations
        // section above. #475 moved that copy to lib/game/consequenceLabels.ts
        // once a second renderer turned out to have its own heading.
        return {
          ...CONSEQUENCE_LABELS.debt,
          bgColor: 'bg-myth-warn/10',
          borderColor: 'border-myth-warn/30',
          textColor: 'text-myth-ink',
          iconColor: 'text-myth-warn',
        }
      case 'enemy':
        return {
          ...CONSEQUENCE_LABELS.enemy,
          bgColor: 'bg-myth-danger/10',
          borderColor: 'border-myth-danger/30',
          textColor: 'text-myth-danger',
          iconColor: 'text-myth-danger'
        }
      case 'longTermThreat':
        return {
          ...CONSEQUENCE_LABELS.longTermThreat,
          bgColor: 'bg-myth-danger/10',
          borderColor: 'border-myth-danger/20',
          textColor: 'text-myth-danger',
          iconColor: 'text-myth-danger'
        }
    }
  }

  const config = getTypeConfig()
  const TypeIcon = CONSEQUENCE_ICONS[type]

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
          <div className={`mb-1 flex items-center gap-1.5 text-xs font-semibold ${config.iconColor}`}>
            <TypeIcon className="h-3.5 w-3.5 flex-shrink-0" />
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
