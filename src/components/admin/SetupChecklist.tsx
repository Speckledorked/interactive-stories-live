import Link from 'next/link'
import { Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export interface SetupChecklistItem {
  label: string
  done: boolean
  href: string
  /** Omit for required items — they need no badge, everything else is the exception. */
  badge?: 'recommended' | 'optional'
  required?: boolean
}

// Array-driven so the list can grow without touching layout. Collapses to
// a single "Setup complete" line once every required item is done —
// recommended/optional items don't block the collapse.
export function SetupChecklist({ items }: { items: SetupChecklistItem[] }) {
  const requiredItems = items.filter((i) => i.required)
  const requiredComplete = requiredItems.length > 0 && requiredItems.every((i) => i.done)

  if (requiredComplete) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-myth-good/30 bg-myth-good/10 px-3 py-2 text-sm text-myth-good">
        <Check className="h-4 w-4 shrink-0" />
        Setup complete
      </div>
    )
  }

  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.label}>
          <Link
            href={item.href}
            className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-myth-surface-sunken"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  item.done ? 'border-myth-good bg-myth-good/10 text-myth-good' : 'border-myth-border text-transparent'
                }`}
              >
                <Check className="h-3 w-3" />
              </span>
              <span className={`truncate text-sm ${item.done ? 'text-myth-ink-muted line-through' : 'text-myth-ink'}`}>
                {item.label}
              </span>
            </span>
            {item.badge && <Badge variant={item.badge}>{item.badge}</Badge>}
          </Link>
        </li>
      ))}
    </ul>
  )
}
