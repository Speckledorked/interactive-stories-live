// Small shared UI primitives for the tavern theme — buttons, cards, banners.
// Kept intentionally minimal; pages compose these rather than each
// reinventing the same gradient/border/shadow combo.

import { displayFont } from '@/lib/tavernTheme'

export function TavernButton({
  children,
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  const base = 'px-4 py-2.5 rounded-lg border font-medium transition-all disabled:opacity-50 text-sm'
  const styles =
    variant === 'primary'
      ? 'bg-gradient-to-b from-wine-500 to-wine-700 hover:from-wine-400 hover:to-wine-600 text-ember-100 border-ember-900/50 shadow-lg shadow-black/40'
      : 'bg-black/30 hover:bg-black/40 border-ember-900/40 text-ember-300'
  return (
    <button className={`${base} ${styles} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function TavernCard({ children, className = '', onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 ${
        onClick ? 'cursor-pointer hover:border-ember-700/50 transition-colors' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}

export function TavernErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 px-4 py-3 rounded-lg bg-wine-800/30 border border-wine-600/40 text-ember-100 text-sm">
      {children}
    </div>
  )
}

export function TavernEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="text-center py-16 rounded-2xl border border-ember-900/30 bg-black/30">
      <Icon className="w-12 h-12 mx-auto text-ember-600/60 mb-4" />
      <p className={`${displayFont.className} text-lg text-ember-200 mb-2`}>{title}</p>
      {description && <p className="text-ember-300/50 mb-6">{description}</p>}
      {action}
    </div>
  )
}

export function TavernSpinner({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <div className="flex justify-center py-16">
      <div className={`spinner ${className}`} />
    </div>
  )
}
