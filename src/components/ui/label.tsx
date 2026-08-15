// src/components/ui/label.tsx
//
// Myth-token rewrite. Mostly superseded by the built-in `label` prop on
// Input/Textarea/Select — kept for the cases those don't cover, like a
// label over a custom control group (a radio set, a toggle row).

import React from 'react'
import { cn } from './styles'

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean
}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { className = '', required, children, ...props },
  ref
) {
  return (
    <label
      ref={ref}
      className={cn(
        'block text-sm font-medium leading-none text-myth-ink-muted peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className
      )}
      {...props}
    >
      {children}
      {required && <span className="ml-1 text-myth-danger">*</span>}
    </label>
  )
})
