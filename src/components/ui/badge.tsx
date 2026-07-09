import React from 'react'

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'destructive'
}

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className = '', variant = 'default', ...props }, ref) => {
    const variantStyles = {
      default: 'bg-wine-600 text-ember-100',
      secondary: 'bg-black/30 text-ember-200/80 border border-ember-900/30',
      outline: 'border border-ember-900/40 bg-black/20 text-ember-200/80',
      destructive: 'bg-wine-700 text-ember-100'
    }

    return (
      <div
        ref={ref}
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${variantStyles[variant]} ${className}`}
        {...props}
      />
    )
  }
)

Badge.displayName = 'Badge'
