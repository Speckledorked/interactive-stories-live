// src/components/ui/dialog.tsx
//
// Rewritten onto myth tokens and given the behaviour it was missing:
// focus trap, Escape to close, body scroll lock, focus restoration, and
// correct dialog ARIA. The previous version rendered a bare div with an
// overlay — keyboard focus stayed on the page behind it and Escape did
// nothing.
//
// Mobile-first shape: below `sm` this is a bottom sheet pinned to the
// bottom edge (thumb-reachable, the platform-native pattern on a phone),
// and from `sm` up it becomes the familiar centred modal. Same component,
// no per-call-site branching.

'use client'

import React from 'react'
import { X } from 'lucide-react'
import { cn } from './styles'
import { IconButton } from './icon-button'

interface DialogContextValue {
  open: boolean
  onOpenChange?: (open: boolean) => void
  titleId: string
}

const DialogContext = React.createContext<DialogContextValue>({ open: false, titleId: '' })

export interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

export function Dialog({ open = false, onOpenChange, children }: DialogProps) {
  const titleId = React.useId()
  return (
    <DialogContext.Provider value={{ open, onOpenChange, titleId }}>{children}</DialogContext.Provider>
  )
}

export interface DialogTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Render the single child element as the trigger instead of wrapping it
   * in a <button>. Required when the child is itself a button (e.g. our
   * own <Button>), since nesting one button inside another is invalid
   * HTML and breaks keyboard activation.
   */
  asChild?: boolean
}

export const DialogTrigger = React.forwardRef<HTMLButtonElement, DialogTriggerProps>(
  function DialogTrigger({ onClick, asChild, children, ...props }, ref) {
    const { onOpenChange } = React.useContext(DialogContext)

    const open = (e: React.MouseEvent<HTMLElement>) => {
      ;(onClick as ((e: React.MouseEvent<HTMLElement>) => void) | undefined)?.(e)
      onOpenChange?.(true)
    }

    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<{ onClick?: (e: React.MouseEvent<HTMLElement>) => void }>
      return React.cloneElement(child, {
        onClick: (e: React.MouseEvent<HTMLElement>) => {
          child.props.onClick?.(e)
          open(e)
        },
      })
    }

    return (
      <button ref={ref} type="button" onClick={open} {...props}>
        {children}
      </button>
    )
  }
)

/** Elements that can hold focus, for the trap's tab cycling. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Hides the built-in close button — provide your own in that case. */
  hideClose?: boolean
}

export const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(function DialogContent(
  { className = '', children, hideClose = false, ...props },
  ref
) {
  const { open, onOpenChange, titleId } = React.useContext(DialogContext)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const restoreFocusTo = React.useRef<HTMLElement | null>(null)

  // Escape to close + tab trapping, and remember what to focus on the way
  // out so closing a dialog doesn't dump focus back to the top of the page.
  React.useEffect(() => {
    if (!open) return

    restoreFocusTo.current = document.activeElement as HTMLElement | null

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onOpenChange?.(false)
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return

      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null
      )
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)

    // Scroll lock. Preserve whatever the page already had rather than
    // assuming it was the default, so closing restores it faithfully.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Move focus into the panel on open.
    const raf = requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
      ;(target ?? panelRef.current)?.focus()
    })

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      cancelAnimationFrame(raf)
      restoreFocusTo.current?.focus?.()
    }
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => onOpenChange?.(false)}
        aria-hidden
      />
      <div
        ref={(node) => {
          panelRef.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative z-50 w-full bg-myth-surface-raised text-myth-ink shadow-2xl',
          // Bottom sheet on a phone, centred modal from sm up.
          'max-h-[90vh] overflow-y-auto rounded-t-2xl',
          'sm:mx-4 sm:max-w-lg sm:rounded-2xl sm:border sm:border-myth-border',
          className
        )}
        {...props}
      >
        {!hideClose && (
          <div className="absolute right-2 top-2 z-10">
            <IconButton icon={X} label="Close" size="sm" onClick={() => onOpenChange?.(false)} />
          </div>
        )}
        {children}
      </div>
    </div>
  )
})

export const DialogHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function DialogHeader({ className = '', ...props }, ref) {
    return <div ref={ref} className={cn('flex flex-col gap-1.5 p-5 pb-0', className)} {...props} />
  }
)

export const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  function DialogTitle({ className = '', id, ...props }, ref) {
    const { titleId } = React.useContext(DialogContext)
    return (
      <h2
        ref={ref}
        id={id ?? titleId}
        className={cn('font-display text-lg font-semibold leading-tight text-myth-ink', className)}
        {...props}
      />
    )
  }
)

export const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function DialogDescription({ className = '', ...props }, ref) {
  return <p ref={ref} className={cn('text-sm text-myth-ink-muted', className)} {...props} />
})

export const DialogBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function DialogBody({ className = '', ...props }, ref) {
    return <div ref={ref} className={cn('p-5', className)} {...props} />
  }
)

export const DialogFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function DialogFooter({ className = '', ...props }, ref) {
    return (
      <div
        ref={ref}
        // Stacked and reversed on mobile so the primary action sits at the
        // bottom, nearest the thumb; inline and right-aligned from sm up.
        className={cn(
          'flex flex-col-reverse gap-2 p-5 pt-0 sm:flex-row sm:items-center sm:justify-end',
          className
        )}
        {...props}
      />
    )
  }
)
