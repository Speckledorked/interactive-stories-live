// src/components/ui/tabs.tsx
//
// The in-page tab row. Seven separate places hand-rolled this — the lobby,
// the character sheet, the snapshot modal, the notification panel, the
// character-creation form, the lore manager, and the roster filter — in two
// visual dialects (an underline rule and a filled pill) with five different
// active-state treatments between them.
//
// Both dialects live here as `variant`, because they aren't arbitrary: the
// underline reads as "these are sections of the thing below", the pill as
// "these filter the list below". Which one a surface wants is a real
// decision; how it's drawn shouldn't be.
//
// The whole row is a real tablist — role/aria-selected wiring that none of
// the seven originals had. Tabs also scroll horizontally rather than
// wrapping, which is what keeps a six-tab row usable at 390px.

import React from 'react'
import { FOCUS_RING, cn } from './styles'

export interface TabItem<K extends string = string> {
  key: K
  label: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  /** Small trailing count, e.g. an unread badge on a filter tab. */
  count?: number
}

export interface TabsProps<K extends string = string> {
  items: ReadonlyArray<TabItem<K>>
  value: K
  onChange: (key: K) => void
  variant?: 'underline' | 'pill'
  /** Divide the row evenly — what a modal or panel header wants. */
  fullWidth?: boolean
  className?: string
  'aria-label'?: string
}

export function Tabs<K extends string = string>({
  items,
  value,
  onChange,
  variant = 'underline',
  fullWidth = false,
  className = '',
  'aria-label': ariaLabel,
}: TabsProps<K>) {
  const underline = variant === 'underline'

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'flex items-center overflow-x-auto',
        underline ? 'gap-2 border-b border-myth-border' : 'gap-2 rounded-lg bg-myth-surface-sunken p-1',
        className
      )}
    >
      {items.map((tab) => {
        const active = tab.key === value
        const Icon = tab.icon
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={cn(
              'inline-flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap px-3 text-sm font-medium transition-colors touch-manipulation',
              fullWidth ? 'flex-1' : 'flex-shrink-0',
              underline
                ? active
                  ? // -mb-px pulls the tab's own rule over the row's border so
                    // the two read as one line, not two stacked ones.
                    '-mb-px border-b-2 border-myth-accent text-myth-ink'
                  : '-mb-px border-b-2 border-transparent text-myth-ink-faint hover:text-myth-ink'
                : active
                  ? 'rounded-md bg-myth-surface text-myth-ink shadow-sm'
                  : 'rounded-md text-myth-ink-faint hover:text-myth-ink',
              FOCUS_RING
            )}
          >
            {Icon && <Icon className="h-4 w-4 flex-shrink-0" />}
            {tab.label}
            {typeof tab.count === 'number' && tab.count > 0 && (
              <span
                className={cn(
                  'ml-0.5 rounded-full px-1.5 font-mono text-[10px] leading-4',
                  active ? 'bg-myth-accent text-myth-accent-ink' : 'bg-myth-surface-sunken text-myth-ink-faint'
                )}
              >
                {tab.count > 99 ? '99+' : tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
