// src/components/ui/alert.tsx
//
// Rewritten onto myth tokens. Gains the semantic tones the app actually
// uses (the old version only had default/destructive, so info and success
// states were hand-rolled inline everywhere), plus the right ARIA role —
// `alert` for errors so a screen reader announces them, `status` for the
// quieter tones so they don't interrupt.

import React from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from './styles'

export type AlertTone = 'info' | 'success' | 'warning' | 'danger'

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone
  title?: string
  /** Set false to drop the leading icon. */
  showIcon?: boolean
}

const TONES: Record<AlertTone, { box: string; icon: React.ComponentType<{ className?: string }> }> = {
  info: { box: 'border-myth-info/30 bg-myth-info/10 text-myth-info', icon: Info },
  success: { box: 'border-myth-good/30 bg-myth-good/10 text-myth-good', icon: CheckCircle2 },
  warning: { box: 'border-myth-warn/30 bg-myth-warn/10 text-myth-warn', icon: AlertTriangle },
  danger: { box: 'border-myth-danger/30 bg-myth-danger/10 text-myth-danger', icon: XCircle },
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { className = '', tone = 'info', title, showIcon = true, children, ...props },
  ref
) {
  const { box, icon: Icon } = TONES[tone]

  return (
    <div
      ref={ref}
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-sm', box, className)}
      {...props}
    >
      {showIcon && <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  )
})

export const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function AlertDescription({ className = '', ...props }, ref) {
    return <p ref={ref} className={cn('text-sm', className)} {...props} />
  }
)
