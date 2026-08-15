// src/components/ui/input.tsx
//
// New — there was no shared text input, so 94 raw <input> elements were
// each styled inline. Shares FIELD_BASE with textarea/select so the three
// can't drift apart.
//
// The `label`/`hint`/`error` props exist so the accessible wiring
// (htmlFor, aria-describedby, aria-invalid) happens once here rather than
// being remembered per call site — it mostly wasn't.

import React from 'react'
import { FIELD_BASE, FIELD_ERROR, TOUCH_HEIGHT, cn } from './styles'

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string
  hint?: string
  error?: string
  /** Marks the field visually and via aria as required. */
  required?: boolean
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = '', label, hint, error, id, required, ...props },
  ref
) {
  const reactId = React.useId()
  const inputId = id ?? reactId
  const hintId = hint ? `${inputId}-hint` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-myth-ink-muted">
          {label}
          {required && <span className="ml-1 text-myth-danger">*</span>}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(FIELD_BASE, TOUCH_HEIGHT, error && FIELD_ERROR, className)}
        {...props}
      />
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs text-myth-ink-faint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 text-xs text-myth-danger">
          {error}
        </p>
      )}
    </div>
  )
})
