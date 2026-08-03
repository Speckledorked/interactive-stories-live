// Bottom tab bar shared by every redesigned page.
//
// variant="myth" (opt-in) swaps the permanently-dark bar for a flat,
// theme-adaptive myth-surface one with the accent color on the active
// item. Every other consumer keeps the unchanged default.
//
// Active state is auto-detected from the URL (usePathname/useSearchParams)
// rather than trusting a per-page `active` prop — most pages never passed
// one, so the bar silently never highlighted anything on them. The prop
// stays in the signature for existing callers but is no longer consulted.
// useSearchParams() requires a Suspense boundary to avoid opting pages
// out of static prerendering, so the hook-using logic lives in a small
// inner component wrapped here — callers don't need to change anything.

'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Beer, Map as MapIcon, Users, Target, Settings as SettingsIcon } from 'lucide-react'

export type TavernNavKey = 'tavern' | 'map' | 'characters' | 'quests' | 'settings'

function TavernNavInner({
  campaignId,
  variant = 'tavern',
}: {
  campaignId?: string
  variant?: 'tavern' | 'myth'
}) {
  const myth = variant === 'myth'
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab')
  const campaignHome = campaignId ? `/campaigns/${campaignId}` : null
  const isCampaignHome = campaignHome !== null && pathname === campaignHome

  const items = [
    {
      key: 'tavern' as const,
      label: 'Tavern',
      icon: Beer,
      href: '/campaigns',
      isActive: pathname === '/campaigns',
    },
    {
      key: 'map' as const,
      label: 'Map',
      icon: MapIcon,
      href: campaignId ? `/campaigns/${campaignId}?tab=maps` : null,
      isActive: isCampaignHome && tab === 'maps',
    },
    {
      key: 'characters' as const,
      label: 'Characters',
      icon: Users,
      href: campaignId ? `/campaigns/${campaignId}/characters` : null,
      isActive: campaignHome !== null && pathname.startsWith(`${campaignHome}/characters`),
    },
    {
      key: 'quests' as const,
      label: 'Quests',
      icon: Target,
      href: campaignId ? `/campaigns/${campaignId}/quests` : null,
      isActive: campaignHome !== null && pathname.startsWith(`${campaignHome}/quests`),
    },
    {
      key: 'settings' as const,
      label: 'Settings',
      icon: SettingsIcon,
      href: '/settings',
      isActive: pathname === '/settings',
    },
  ]

  return (
    <nav
      className={
        myth
          ? 'fixed bottom-0 inset-x-0 z-30 bg-myth-surface/90 backdrop-blur-md border-t border-myth-border pb-[env(safe-area-inset-bottom)] lg:hidden'
          : 'fixed bottom-0 inset-x-0 z-30 bg-black/70 backdrop-blur-md border-t border-ember-900/40 pb-[env(safe-area-inset-bottom)]'
      }
    >
      <div className="max-w-2xl mx-auto grid grid-cols-5">
        {items.map((item) => {
          const activeClass = myth ? 'text-myth-accent' : 'text-ember-300'
          const inactiveClass = myth ? 'text-myth-ink-faint' : 'text-ember-500/40'
          const hoverClass = myth ? 'hover:text-myth-ink-muted' : 'hover:text-ember-200'
          const pillClass = myth && item.isActive ? 'bg-myth-accent/10' : ''
          const content = (
            <div
              className={`mx-1.5 flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] transition-colors touch-manipulation ${pillClass} ${
                item.isActive ? activeClass : inactiveClass
              } ${item.href ? hoverClass : 'cursor-default'}`}
            >
              <item.icon className="w-5 h-5" />
              <span className={myth ? 'uppercase tracking-wide' : ''}>{item.label}</span>
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

export function TavernNav(props: { active?: TavernNavKey; campaignId?: string; variant?: 'tavern' | 'myth' }) {
  const myth = props.variant === 'myth'
  return (
    <Suspense
      fallback={
        <nav
          className={
            myth
              ? 'fixed bottom-0 inset-x-0 z-30 h-[68px] bg-myth-surface/90 backdrop-blur-md border-t border-myth-border pb-[env(safe-area-inset-bottom)] lg:hidden'
              : 'fixed bottom-0 inset-x-0 z-30 h-[68px] bg-black/70 backdrop-blur-md border-t border-ember-900/40 pb-[env(safe-area-inset-bottom)]'
          }
        />
      }
    >
      <TavernNavInner campaignId={props.campaignId} variant={props.variant} />
    </Suspense>
  )
}
