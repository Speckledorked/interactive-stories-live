// src/components/ui/textarea.tsx
//
// Rewritten from the old ember/wine version onto myth tokens, and given
// the character counter the story page's action form needs (the mockup's
// "0 / 600"). Counter only renders when maxLength is set, so existing
// uncounted textareas are unaffected.

import React from 'react'
import { FIELD_BASE, FIELD_ERROR, cn } from './styles'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  error?: string
  /** Layout classes for the wrapper, not the field. See Input's own
   * `wrapperClassName` for why layout and chrome are separated. */
  wrapperClassName?: string
  /** Renders a live `n / max` counter under the field. Requires maxLength. */
  showCount?: boolean
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className = '', wrapperClassName = 'w-full', label, hint, error, showCount, maxLength, id, required, value, ...props },
  ref
) {
  const reactId = React.useId()
  const textareaId = id ?? reactId
  const hintId = hint ? `${textareaId}-hint` : undefined
  const errorId = error ? `${textareaId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  const count = typeof value === 'string' ? value.length : 0
  const showCounter = showCount && typeof maxLength === 'number'
  // Warn as the limit approaches rather than only at the wall, so a long
  // action isn't silently truncated mid-thought.
  const nearLimit = showCounter && count > maxLength * 0.9

  return (
    <div className={wrapperClassName}>
      {label && (
        <label htmlFor={textareaId} className="mb-1.5 block text-sm font-medium text-myth-ink-muted">
          {label}
          {required && <span className="ml-1 text-myth-danger">*</span>}
        </label>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        required={required}
        maxLength={maxLength}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(FIELD_BASE, 'min-h-[120px] resize-y', error && FIELD_ERROR, className)}
        {...props}
      />
      <div className="mt-1.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {hint && !error && (
            <p id={hintId} className="text-xs text-myth-ink-faint">
              {hint}
            </p>
          )}
          {error && (
            <p id={errorId} className="text-xs text-myth-danger">
              {error}
            </p>
          )}
        </div>
        {showCounter && (
          <p
            aria-live="polite"
            className={cn(
              'flex-shrink-0 font-mono text-xs tabular-nums',
              nearLimit ? 'text-myth-warn' : 'text-myth-ink-faint'
            )}
          >
            {count} / {maxLength}
          </p>
        )}
      </div>
    </div>
  )
})
