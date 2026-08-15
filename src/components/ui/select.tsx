// src/components/ui/select.tsx
//
// New — 26 raw <select> elements were styled inline, each re-solving the
// native-arrow problem differently (or not at all). Uses the platform
// <select> deliberately rather than a custom listbox: on mobile, which is
// this app's primary target, the native picker is a better control than
// anything reimplementable, and it comes with correct keyboard and
// screen-reader behaviour for free.

import React from 'react'
import { ChevronDown } from 'lucide-react'
import { FIELD_BASE, FIELD_ERROR, TOUCH_HEIGHT, cn } from './styles'

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  hint?: string
  error?: string
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className = '', label, hint, error, id, required, children, ...props },
  ref
) {
  const reactId = React.useId()
  const selectId = id ?? reactId
  const hintId = hint ? `${selectId}-hint` : undefined
  const errorId = error ? `${selectId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={selectId} className="mb-1.5 block text-sm font-medium text-myth-ink-muted">
          {label}
          {required && <span className="ml-1 text-myth-danger">*</span>}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            FIELD_BASE,
            TOUCH_HEIGHT,
            // Room for the chevron, and suppress the platform arrow so the
            // control looks identical across browsers.
            'appearance-none pr-10',
            error && FIELD_ERROR,
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-myth-ink-faint"
        />
      </div>
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
