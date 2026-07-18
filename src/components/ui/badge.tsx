import React from 'react'

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?:
    | 'default'
    | 'secondary'
    | 'outline'
    | 'destructive'
    | 'gmOnly'
    | 'visible'
    | 'public'
    | 'advanced'
    | 'recommended'
    | 'dangerous'
    | 'optional'
}

// MythOS semantic variants (gmOnly/visible/public/advanced/recommended/
// dangerous/optional) share one shape: a low-opacity tint of a single
// semantic color plus full-opacity text of that same color. "public" is
// the one variant allowed to use the brass accent — see design brief.
const semanticVariantStyles = {
  gmOnly: 'bg-myth-info/10 text-myth-info',
  visible: 'bg-myth-good/10 text-myth-good',
  public: 'bg-myth-accent/10 text-myth-accent',
  advanced: 'bg-myth-info/10 text-myth-info',
  recommended: 'bg-myth-good/10 text-myth-good',
  dangerous: 'bg-myth-danger/10 text-myth-danger',
  optional: 'bg-myth-ink/5 text-myth-ink-muted',
} as const

const legacyVariantStyles = {
  default: 'bg-wine-600 text-ember-100',
  secondary: 'bg-black/30 text-ember-200/80 border border-ember-900/30',
  outline: 'border border-ember-900/40 bg-black/20 text-ember-200/80',
  destructive: 'bg-wine-700 text-ember-100',
} as const

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className = '', variant = 'default', ...props }, ref) => {
    if (variant in semanticVariantStyles) {
      const semanticStyle = semanticVariantStyles[variant as keyof typeof semanticVariantStyles]
      return (
        <div
          ref={ref}
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider transition-colors ${semanticStyle} ${className}`}
          {...props}
        />
      )
    }

    const legacyStyle = legacyVariantStyles[variant as keyof typeof legacyVariantStyles]
    return (
      <div
        ref={ref}
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${legacyStyle} ${className}`}
        {...props}
      />
    )
  }
)

Badge.displayName = 'Badge'
