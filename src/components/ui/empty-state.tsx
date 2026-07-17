import React from 'react'

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

function ActionButton({ action, primary }: { action: EmptyStateAction; primary?: boolean }) {
  const className = primary
    ? 'inline-flex items-center justify-center rounded-md bg-myth-accent px-4 py-2 text-sm font-medium text-myth-accent-ink transition-colors hover:bg-myth-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-myth-accent focus-visible:ring-offset-2'
    : 'inline-flex items-center justify-center rounded-md border border-myth-border px-4 py-2 text-sm font-medium text-myth-ink-muted transition-colors hover:border-myth-border-strong hover:text-myth-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-myth-accent focus-visible:ring-offset-2'

  if (action.href) {
    return (
      <a href={action.href} className={className}>
        {action.label}
      </a>
    )
  }

  return (
    <button type="button" onClick={action.onClick} className={className}>
      {action.label}
    </button>
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
