import React from 'react'
import { Button, buttonClasses } from './button'

export interface EmptyStateAction {
  label: string
  onClick?: () => void
  href?: string
}

export interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: EmptyStateAction
  secondaryAction?: EmptyStateAction
  className?: string
}

// Goes through the Button primitive rather than hand-rolling its classes.
// It used to do the latter, and drifted: `rounded-md` where the app has
// exactly one control radius, and py-2 with no min-height, which rendered
// 36px tall — under the 44px touch rule, on what is often a brand-new
// user's very first tap target ("Create Your First Campaign").
function ActionButton({ action, primary }: { action: EmptyStateAction; primary?: boolean }) {
  const variant = primary ? 'primary' : 'secondary'

  // An action with an href navigates, so it has to be an anchor — the one
  // case Button itself can't render. Same classes either way.
  if (action.href) {
    return (
      <a href={action.href} className={buttonClasses({ variant })}>
        {action.label}
      </a>
    )
  }

  return (
    <Button variant={variant} onClick={action.onClick}>
      {action.label}
    </Button>
  )
}

export function EmptyState({ icon, title, description, action, secondaryAction, className = '' }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-start gap-3 rounded-lg border border-dashed border-myth-border p-6 text-left ${className}`}
    >
      {icon && <div className="text-myth-ink-faint">{icon}</div>}
      <div className="space-y-1">
        <p className="text-sm font-medium text-myth-ink">{title}</p>
        {description && <p className="text-sm text-myth-ink-muted">{description}</p>}
      </div>
      {(action || secondaryAction) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {action && <ActionButton action={action} primary />}
          {secondaryAction && <ActionButton action={secondaryAction} />}
        </div>
      )}
    </div>
  )
}
