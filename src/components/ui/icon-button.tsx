// src/components/ui/icon-button.tsx
//
// A button whose only content is an icon, so it MUST carry an accessible
// label — that's the main reason this exists as its own primitive rather
// than a Button variant: the label can be a required prop here.
//
// Sizing note: the header's icon buttons were `p-2.5` around a 20px glyph
// = 40px square, just under the 44px comfortable minimum on a phone. This
// primitive can't reproduce that mistake — TOUCH_TARGET's min-h/min-w
// floor applies at every size, with the visual padding varying instead.

import React from 'react'
import { CONTROL_RADIUS, DISABLED, FOCUS_RING, TOUCH_TARGET, cn } from './styles'

export type IconButtonSize = 'sm' | 'md' | 'lg'

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: React.ComponentType<{ className?: string }>
  /** Required: an icon alone conveys nothing to a screen reader. */
  label: string
  size?: IconButtonSize
  variant?: 'ghost' | 'secondary' | 'danger'
  /** Optional count badge, e.g. unread notifications on the bell. */
  badge?: number
}

const GLYPH: Record<IconButtonSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
}

const VARIANTS = {
  ghost: 'text-myth-ink-muted hover:bg-myth-surface-sunken hover:text-myth-ink',
  secondary: 'border border-myth-border text-myth-ink-muted hover:border-myth-border-strong hover:text-myth-ink',
  danger: 'text-myth-danger hover:bg-myth-danger/10',
} as const

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className = '', icon: Icon, label, size = 'md', variant = 'ghost', badge, type = 'button', ...props },
  ref
) {
  // Cap the display at 99+ so a runaway count can't stretch the chrome.
  const badgeText = typeof badge === 'number' && badge > 0 ? (badge > 99 ? '99+' : String(badge)) : null

  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'relative inline-flex items-center justify-center transition-colors',
        CONTROL_RADIUS,
        TOUCH_TARGET,
        VARIANTS[variant],
        DISABLED,
        className,
        FOCUS_RING
      )}
      {...props}
    >
      <Icon className={GLYPH[size]} />
      {badgeText && (
        <span
          // aria-hidden: the count is already in the button's own label via
          // the caller (e.g. "Notifications, 3 unread"), so exposing it
          // twice would make the control read redundantly.
          aria-hidden
          className="absolute right-1 top-1 min-w-[1.125rem] rounded-full bg-myth-danger px-1 text-center font-mono text-[10px] font-semibold leading-[1.125rem] text-myth-danger-ink"
        >
          {badgeText}
        </span>
      )}
    </button>
  )
})
