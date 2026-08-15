// src/components/ui/button.tsx
//
// The app's one button. Replaces both the old ember/wine-palette version
// (which only two files ever imported) and the ~222 hand-styled raw
// <button> elements the audit found across 61 files.
//
// Every variant/size carries FOCUS_RING and TOUCH_TARGET from
// ./styles — the two things that were missing app-wide. `sm` is visually
// smaller but keeps the same 44px minimum hit area, because this app is
// mobile-first (docs/design-system.md) and a small-looking button on a
// phone still has to be tappable.

import React from 'react'
import { CONTROL_RADIUS, DISABLED, FOCUS_RING, TOUCH_TARGET, cn } from './styles'
import { Spinner } from './spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner, disables the button, and sets aria-busy. */
  loading?: boolean
  /** Icon rendered before the label. Pass a lucide component, not an emoji. */
  icon?: React.ComponentType<{ className?: string }>
  /** Icon rendered after the label — e.g. ChevronRight on a forward action. */
  iconRight?: React.ComponentType<{ className?: string }>
  /** Stretch to the container's width. Common at mobile widths. */
  fullWidth?: boolean
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-myth-accent text-myth-accent-ink hover:bg-myth-accent-hover border border-transparent',
  secondary:
    'bg-myth-surface text-myth-ink-muted border border-myth-border hover:border-myth-border-strong hover:text-myth-ink',
  ghost: 'bg-transparent text-myth-ink-muted border border-transparent hover:bg-myth-surface-sunken hover:text-myth-ink',
  // text-myth-danger-ink, not text-white: dark mode's danger fill is a
  // light salmon where white measures 3.60:1. The token flips per theme.
  danger: 'bg-myth-danger text-myth-danger-ink hover:opacity-90 border border-transparent',
}

// Padding/text only — vertical size comes from TOUCH_TARGET's min-h, so
// `sm` stays tappable rather than becoming a 32px sliver on a phone.
const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2.5 text-sm gap-2',
  lg: 'px-6 py-3 text-base gap-2',
}

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
}

/**
 * The button's full class string, for the one case `Button` itself can't
 * cover: a control that must render as an `<a>` because it navigates.
 *
 * This exists so "I need a button-shaped link" never again means
 * hand-rolling the classes — which is exactly how EmptyState ended up
 * with a 36px-tall, `rounded-md` action button that missed both the 44px
 * touch rule and the app's single control radius. Prefer `<Button>`;
 * reach for this only when the element genuinely has to be an anchor.
 */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  className?: string
} = {}): string {
  return cn(
    'inline-flex items-center justify-center font-medium transition-colors',
    CONTROL_RADIUS,
    TOUCH_TARGET,
    SIZES[size],
    VARIANTS[variant],
    DISABLED,
    fullWidth && 'w-full',
    className,
    // Last so a caller's className can never accidentally drop it.
    FOCUS_RING
  )
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className = '',
    variant = 'primary',
    size = 'md',
    loading = false,
    icon: Icon,
    iconRight: IconRight,
    fullWidth = false,
    disabled,
    children,
    type = 'button',
    ...props
  },
  ref
) {
  const iconClass = ICON_SIZES[size]

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...props}
    >
      {loading ? (
        <Spinner className={iconClass} />
      ) : (
        Icon && <Icon className={cn(iconClass, 'flex-shrink-0')} />
      )}
      {children}
      {IconRight && !loading && <IconRight className={cn(iconClass, 'flex-shrink-0')} />}
    </button>
  )
})
