// src/components/ui/switch.tsx
//
// The on/off toggle. Exists because NotificationSettings hand-rolled the
// same 44px-wide sliding pill twice in one file, with no accessible role
// at all — a sighted user saw a switch, a screen reader heard "button".
//
// role="switch" + aria-checked is what makes it announce as a toggle. The
// visual track stays 24px tall (the platform expectation); the 44px
// minimum hit area comes from TOUCH_TARGET on the button itself, so the
// tappable region is larger than the pill it draws.

import React from 'react'
import { DISABLED, FOCUS_RING, cn } from './styles'

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Accessible name. Required unless the caller wires aria-labelledby. */
  label?: string
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, label, className = '', disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg touch-manipulation',
        DISABLED,
        className,
        FOCUS_RING
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
          checked ? 'bg-myth-accent' : 'bg-myth-surface-sunken border border-myth-border'
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-myth-canvas shadow transition-transform',
            checked ? 'translate-x-6' : 'translate-x-1'
          )}
        />
      </span>
    </button>
  )
})
