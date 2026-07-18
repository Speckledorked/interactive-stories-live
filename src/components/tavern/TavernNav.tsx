// Bottom tab bar shared by every redesigned page.
//
// variant="myth" (opt-in, used only by the two MythOS-redesign pages)
// swaps the permanently-dark bar for a flat, theme-adaptive myth-surface
// one with the brass accent on the active item. Every other consumer
// keeps the unchanged default.

'use client'

import Link from 'next/link'
import { Beer, Compass, Users, Scroll, Settings as SettingsIcon } from 'lucide-react'

export type TavernNavKey = 'tavern' | 'map' | 'characters' | 'quests' | 'settings'

export function TavernNav({
  active,
  campaignId,
  variant = 'tavern',
}: {
  active?: TavernNavKey
  campaignId?: string
  variant?: 'tavern' | 'myth'
}) {
  const myth = variant === 'myth'
  const items = [
    { key: 'tavern' as const, label: 'Tavern', icon: Beer, href: '/campaigns' },
    {
      key: 'map' as const,
      label: 'Map',
      icon: Compass,
      href: campaignId ? `/campaigns/${campaignId}?tab=maps` : null,
    },
    {
      key: 'characters' as const,
      label: 'Characters',
      icon: Users,
      href: campaignId ? `/campaigns/${campaignId}/characters` : null,
    },
    {
      key: 'quests' as const,
      label: 'Quests',
      icon: Scroll,
      href: campaignId ? `/campaigns/${campaignId}/story-log` : null,
    },
    { key: 'settings' as const, label: 'Settings', icon: SettingsIcon, href: '/settings' },
  ]

  return (
    <nav
      className={
        myth
          ? 'fixed bottom-0 inset-x-0 z-30 bg-myth-surface/90 backdrop-blur-md border-t border-myth-border pb-[env(safe-area-inset-bottom)]'
          : 'fixed bottom-0 inset-x-0 z-30 bg-black/70 backdrop-blur-md border-t border-ember-900/40 pb-[env(safe-area-inset-bottom)]'
      }
    >
      <div className="max-w-2xl mx-auto grid grid-cols-5">
        {items.map((item) => {
          const activeClass = myth ? 'text-myth-accent' : 'text-ember-300'
          const inactiveClass = myth ? 'text-myth-ink-faint' : 'text-ember-500/40'
          const hoverClass = myth ? 'hover:text-myth-ink-muted' : 'hover:text-ember-200'
          const content = (
            <div
              className={`flex flex-col items-center gap-1 py-3 text-[11px] transition-colors touch-manipulation ${
                item.key === active ? activeClass : inactiveClass
              } ${item.href ? hoverClass : 'cursor-default'}`}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.label}</span>
            </div>
          )
          return item.href ? (
            <Link key={item.key} href={item.href}>
              {content}
            </Link>
          ) : (
            <div key={item.key} title="Not available yet">
              {content}
            </div>
          )
        })}
      </div>
    </nav>
  )
}
