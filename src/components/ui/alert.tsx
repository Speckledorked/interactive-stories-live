import React from 'react'

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'destructive'
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className = '', variant = 'default', ...props }, ref) => {
    const variantStyles = {
      default: 'bg-blue-50 border-blue-200 text-blue-900',
      destructive: 'bg-red-50 border-red-200 text-red-900'
    }

    return (
      <div
        ref={ref}
        className={`relative w-full rounded-lg border p-4 ${variantStyles[variant]} ${className}`}
        {...props}
      />
    )
  }
)

Alert.displayName = 'Alert'

export const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className = '', ...props }, ref) => {
    return (
      <p
        ref={ref}
        className={`text-sm ${className}`}
        {...props}
      />
    )
  }
)

AlertDescription.displayName = 'AlertDescription'
