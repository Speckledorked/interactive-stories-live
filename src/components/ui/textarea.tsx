import React from 'react'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = '', ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={`flex min-h-[80px] w-full rounded-md border border-ember-900/40 bg-black/30 px-3 py-2 text-sm text-ember-100 placeholder:text-ember-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...props}
      />
    )
  }
)

Textarea.displayName = 'Textarea'
