import React from 'react'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'secondary'
  size?: 'default' | 'sm' | 'lg'
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'default', size = 'default', asChild, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50'

    const variantStyles = {
      default: 'bg-blue-600 text-white hover:bg-blue-700',
      outline: 'border border-gray-300 bg-white hover:bg-gray-100',
      ghost: 'hover:bg-gray-100',
      secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300'
    }

    const sizeStyles = {
      default: 'h-10 px-4 py-2',
      sm: 'h-8 px-3 text-sm',
      lg: 'h-12 px-6 text-lg'
    }

    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        {...props}
      />
    )
  }
)

Button.displayName = 'Button'
