// Bottom tab bar shared by every redesigned page.

'use client'

import Link from 'next/link'
import { Beer, Compass, Users, Scroll, Settings as SettingsIcon } from 'lucide-react'

export type TavernNavKey = 'tavern' | 'map' | 'characters' | 'quests' | 'settings'

export function TavernNav({ active, campaignId }: { active?: TavernNavKey; campaignId?: string }) {
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
    <nav className="fixed bottom-0 inset-x-0 z-30 bg-black/70 backdrop-blur-md border-t border-ember-900/40">
      <div className="max-w-2xl mx-auto grid grid-cols-5">
        {items.map((item) => {
          const content = (
            <div
              className={`flex flex-col items-center gap-1 py-3 text-[11px] transition-colors ${
                item.key === active ? 'text-ember-300' : 'text-ember-500/40'
              } ${item.href ? 'hover:text-ember-200' : 'cursor-default'}`}
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
