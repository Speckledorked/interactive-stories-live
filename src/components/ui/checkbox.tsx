// src/components/ui/checkbox.tsx
//
// Checkbox and radio, as their own primitive rather than a mode of Input.
//
// They are a genuinely different control: the label sits beside the box,
// not above it, and the whole row is the tap target — which matters a lot
// more on a phone than on a desktop, where a 16px box is fine to click but
// miserable to tap. Forcing them through Input's label-above layout would
// have produced the wrong markup and lost the row-sized hit area.
//
// The box itself stays visually small (h-4 w-4, the platform expectation);
// the 44px minimum lives on the wrapping <label>, so the comfortable tap
// target is the label text plus the box, which is also what a user
// intuitively aims at.

import React from 'react'
import { FOCUS_RING, cn } from './styles'

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: React.ReactNode
  /** Small muted line under the label. */
  hint?: string
  /** Renders as a radio instead of a checkbox. */
  radio?: boolean
  /** Layout classes for the wrapping label row. */
  wrapperClassName?: string
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className = '', wrapperClassName = '', label, hint, radio = false, id, disabled, ...props },
  ref
) {
  const reactId = React.useId()
  const inputId = id ?? reactId
  const hintId = hint ? `${inputId}-hint` : undefined

  return (
    <label
      htmlFor={inputId}
      className={cn(
        'flex min-h-[44px] cursor-pointer items-start gap-2.5 py-2 touch-manipulation',
        disabled && 'cursor-not-allowed opacity-50',
        wrapperClassName
      )}
    >
      <input
        ref={ref}
        id={inputId}
        type={radio ? 'radio' : 'checkbox'}
        disabled={disabled}
        aria-describedby={hintId}
        className={cn(
          // mt-0.5 optically centres the box against the first line of a
          // label that wraps to two lines.
          'mt-0.5 h-4 w-4 flex-shrink-0 border-myth-border bg-myth-surface text-myth-accent',
          radio ? 'rounded-full' : 'rounded',
          'disabled:cursor-not-allowed',
          className,
          FOCUS_RING
        )}
        {...props}
      />
      {(label || hint) && (
        <span className="min-w-0">
          {label && <span className="block text-sm text-myth-ink-muted">{label}</span>}
          {hint && (
            <span id={hintId} className="mt-0.5 block text-xs text-myth-ink-faint">
              {hint}
            </span>
          )}
        </span>
      )}
    </label>
  )
})
