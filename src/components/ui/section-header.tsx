import React from 'react'

export interface SectionHeaderProps {
  eyebrow?: string
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
  /** @default 'h2' */
  as?: 'h1' | 'h2' | 'h3'
}

// Single source of the app's heading hierarchy: eyebrow (small mono label)
// -> title (display serif) -> description (muted, one line or short).
export function SectionHeader({ eyebrow, title, description, action, className = '', as = 'h2' }: SectionHeaderProps) {
  const Heading = as
  const titleSize = as === 'h1' ? 'text-2xl sm:text-3xl' : as === 'h2' ? 'text-xl sm:text-2xl' : 'text-lg'

  return (
    <div className={`flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="font-mono text-xs uppercase tracking-wider text-myth-ink-faint">{eyebrow}</p>
        )}
        <Heading className={`font-display font-semibold text-myth-ink ${titleSize}`}>{title}</Heading>
        {description && <p className="mt-1 text-sm text-myth-ink-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}
