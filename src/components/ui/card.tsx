// src/components/ui/card.tsx
//
// Rewritten from the old tavern-gradient version onto myth tokens.
//
// The `variant` split encodes docs/design-system.md's narrative-vs-
// reference convention directly in the type system rather than leaving it
// as prose a call site can ignore:
//
// - `reference` — CRUD lists, forms, meters, anything with per-item
//   actions or tabular data. Bordered, raised, depth-shadowed.
// - `narrative` — logs, recaps, summaries, prose meant to be read. No
//   box; whitespace and dividers do the separating instead.
//
// The design-system test for an ambiguous case: "if I stripped the
// border, would you lose the sense that clicking things inside does
// something?" If yes, it's reference.

import React from 'react'
import { cn } from './styles'

export type CardVariant = 'reference' | 'narrative'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
  /** Raised surface — use for cards sitting on an already-surfaced area. */
  raised?: boolean
  /** Adds hover affordance. Pair with an onClick or a wrapping link. */
  interactive?: boolean
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className = '', variant = 'reference', raised = false, interactive = false, ...props },
  ref
) {
  if (variant === 'narrative') {
    return <div ref={ref} className={cn('text-myth-ink-muted', className)} {...props} />
  }

  return (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border border-myth-border',
        raised ? 'bg-myth-surface-raised' : 'bg-myth-surface',
        interactive &&
          'cursor-pointer transition-colors hover:border-myth-border-strong hover:bg-myth-surface-sunken',
        className
      )}
      {...props}
    />
  )
})

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className = '', ...props }, ref) {
    return <div ref={ref} className={cn('flex flex-col gap-1.5 p-5', className)} {...props} />
  }
)

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  function CardTitle({ className = '', ...props }, ref) {
    return (
      <h3
        ref={ref}
        className={cn('font-display text-lg font-semibold leading-tight text-myth-ink', className)}
        {...props}
      />
    )
  }
)

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function CardDescription({ className = '', ...props }, ref) {
    return <p ref={ref} className={cn('text-sm text-myth-ink-muted', className)} {...props} />
  }
)

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className = '', ...props }, ref) {
    return <div ref={ref} className={cn('p-5 pt-0', className)} {...props} />
  }
)

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className = '', ...props }, ref) {
    return (
      <div
        ref={ref}
        // gap-2 rather than a tighter spacing: this row is where
        // Edit/Delete pairs live, and adjacent tap targets need real
        // separation on a phone.
        className={cn('flex flex-wrap items-center gap-2 p-5 pt-0', className)}
        {...props}
      />
    )
  }
)
