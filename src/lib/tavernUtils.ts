// Shared helpers for the tavern theme.

import {
  Sword, TreeDeciduous, Compass, Scroll, Castle, Flame, Skull, Feather, Moon, Mountain, Shield, Swords,
} from 'lucide-react'

// Deterministic banner icon per entity id — stable across reloads without
// needing a real per-campaign theme field.
const BANNER_ICONS = [Sword, TreeDeciduous, Compass, Scroll, Castle, Flame, Skull, Feather, Moon, Mountain, Shield, Swords]
export function bannerIconFor(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return BANNER_ICONS[Math.abs(hash) % BANNER_ICONS.length]
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return diffHr === 1 ? 'Updated 1 hour ago' : `Updated ${diffHr} hours ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay === 1) return 'Updated yesterday'
  if (diffDay < 7) return `Updated ${diffDay}d ago`
  const diffWeek = Math.floor(diffDay / 7)
  if (diffWeek < 5) return `Updated ${diffWeek}w ago`
  return `Updated ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}
