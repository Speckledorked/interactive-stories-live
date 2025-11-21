import React from 'react'

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'destructive'
}

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className = '', variant = 'default', ...props }, ref) => {
    const variantStyles = {
      default: 'bg-blue-600 text-white',
      secondary: 'bg-gray-200 text-gray-900',
      outline: 'border border-gray-300 bg-white text-gray-900',
      destructive: 'bg-red-600 text-white'
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
