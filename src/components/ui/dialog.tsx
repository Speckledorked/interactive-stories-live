'use client'

import React from 'react'

export interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

export const Dialog: React.FC<DialogProps> = ({ open, onOpenChange, children }) => {
  return (
    <DialogContext.Provider value={{ open: open || false, onOpenChange }}>
      {children}
    </DialogContext.Provider>
  )
}

const DialogContext = React.createContext<{ open: boolean; onOpenChange?: (open: boolean) => void }>({
  open: false
})

export const DialogTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }>(
  ({ asChild, onClick, ...props }, ref) => {
    const { onOpenChange } = React.useContext(DialogContext)

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e)
      onOpenChange?.(true)
    }

    if (asChild && React.isValidElement(props.children)) {
      return React.cloneElement(props.children as React.ReactElement, {
        onClick: handleClick
      })
    }

    return <button ref={ref} onClick={handleClick} {...props} />
  }
)

DialogTrigger.displayName = 'DialogTrigger'

export interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className = '', children, ...props }, ref) => {
    const { open, onOpenChange } = React.useContext(DialogContext)

    if (!open) return null

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div
          className="fixed inset-0 bg-black/50"
          onClick={() => onOpenChange?.(false)}
        />
        <div
          ref={ref}
          className={`relative z-50 bg-white rounded-lg shadow-lg p-6 max-w-lg w-full mx-4 ${className}`}
          {...props}
        >
          {children}
        </div>
      </div>
    )
  }
)

DialogContent.displayName = 'DialogContent'

export const DialogHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className = '', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`flex flex-col space-y-1.5 mb-4 ${className}`}
        {...props}
      />
    )
  }
)

DialogHeader.displayName = 'DialogHeader'

export const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className = '', ...props }, ref) => {
    return (
      <h2
        ref={ref}
        className={`text-lg font-semibold leading-none tracking-tight ${className}`}
        {...props}
      />
    )
  }
)

DialogTitle.displayName = 'DialogTitle'

export const DialogDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className = '', ...props }, ref) => {
    return (
      <p
        ref={ref}
        className={`text-sm text-gray-600 ${className}`}
        {...props}
      />
    )
  }
)

DialogDescription.displayName = 'DialogDescription'

export const DialogFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className = '', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`flex items-center justify-end space-x-2 mt-4 ${className}`}
        {...props}
      />
    )
  }
)

DialogFooter.displayName = 'DialogFooter'
