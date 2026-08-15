// Bottom tab bar shared by every redesigned page.
//
// This app is mobile-first (docs/design-system.md), so these five slots
// are the primary navigation, not a reduction of the desktop sidebar.
// They're chosen by how often a player actually needs them:
//
//   Overview · Story · Characters · Quests · More
//
// The Story slot is the correction. The bar used to be
// Tavern · Map · Characters · Quests · Settings, which meant the core
// loop — open a scene, submit an action — had no slot at all on the
// platform the app is mostly used on, while Settings and Map each had
// one. Settings is low-frequency and already reachable from both the
// drawer and the header; Map is one of five world views and belongs
// with the others behind More. "Tavern" (the all-campaigns list) is a
// way *out* of a campaign rather than a destination within one, so it
// moves to the top of the drawer.
//
// A flat, theme-adaptive myth-surface bar, with the accent colour and a
// tinted pill marking the active item. It used to carry a `variant` prop
// selecting between this and a permanently-dark ember bar; every page is
// on the myth system now, so that branch had no callers and is gone.
//
// Active state is auto-detected from the URL (usePathname/useSearchParams)
// rather than trusting a per-page prop — most pages never passed one, so
// the bar silently never highlighted anything on them. useSearchParams()
// requires a Suspense boundary to avoid opting pages out of static
// prerendering, so the hook-using logic lives in a small inner component
// wrapped here; callers don't need to change anything.

'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Home, BookOpen, Users, Target, Menu } from 'lucide-react'
import { openMobileMenu } from './mobileMenuStore'

function TavernNavInner({
  campaignId,
}: {
  campaignId?: string
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab')
  const campaignHome = campaignId ? `/campaigns/${campaignId}` : null
  // The lobby's sections are `?tab=` state on one route, so "Overview" is
  // only active on the lobby with no tab (or an explicit overview tab) —
  // otherwise landing on ?tab=notes would light up Overview too.
  const isLobbyOverview =
    campaignHome !== null && pathname === campaignHome && (tab === null || tab === 'overview')

  const items = [
    {
      key: 'overview',
      label: 'Overview',
      icon: Home,
      href: campaignHome,
      isActive: isLobbyOverview,
    },
    {
      key: 'story',
      label: 'Story',
      icon: BookOpen,
      href: campaignHome ? `${campaignHome}/story` : null,
      isActive: campaignHome !== null && pathname.startsWith(`${campaignHome}/story`),
    },
    {
      key: 'characters',
      label: 'Characters',
      icon: Users,
      href: campaignHome ? `${campaignHome}/characters` : null,
      isActive: campaignHome !== null && pathname.startsWith(`${campaignHome}/characters`),
    },
    {
      key: 'quests',
      label: 'Quests',
      icon: Target,
      href: campaignHome ? `${campaignHome}/quests` : null,
      isActive: campaignHome !== null && pathname.startsWith(`${campaignHome}/quests`),
    },
  ] as const

  const activeClass = 'text-myth-accent'
  const inactiveClass = 'text-myth-ink-faint'
  const hoverClass = 'hover:text-myth-ink-muted'

  const itemClass = (isActive: boolean, interactive: boolean) =>
    [
      // min-h-[56px]: taller than the 44px floor because a stacked
      // icon+label needs the room, and this is the bar a thumb hits most.
      'mx-1.5 flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl py-2 text-[11px] transition-colors touch-manipulation',
      isActive ? 'bg-myth-accent/10' : '',
      isActive ? activeClass : inactiveClass,
      interactive ? hoverClass : 'cursor-default',
    ]
      .filter(Boolean)
      .join(' ')

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 bg-myth-surface/90 backdrop-blur-md border-t border-myth-border pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div className="max-w-2xl mx-auto grid grid-cols-5">
        {items.map((item) => {
          const content = (
            <div className={itemClass(item.isActive, item.href !== null)}>
              <item.icon className="w-5 h-5" />
              <span className="uppercase tracking-wide">{item.label}</span>
            </div>
          )
          return item.href ? (
            <Link key={item.key} href={item.href}>
              {content}
            </Link>
          ) : (
            <div key={item.key} title="Open a campaign first">
              {content}
            </div>
          )
        })}

        {/* More opens the drawer rather than navigating — the drawer is
            where the other ~12 destinations live on mobile (see
            TavernMobileMenu), which is what keeps the sidebar's larger
            link list from stranding phone users. */}
        <button type="button" onClick={openMobileMenu} aria-label="More navigation">
          <div className={itemClass(false, true)}>
            <Menu className="w-5 h-5" />
            <span className="uppercase tracking-wide">More</span>
          </div>
        </button>
      </div>
    </nav>
  )
}

export function TavernNav(props: { campaignId?: string }) {
  return (
    <Suspense
      fallback={
        <nav
          className="fixed bottom-0 inset-x-0 z-30 h-[68px] bg-myth-surface/90 backdrop-blur-md border-t border-myth-border pb-[env(safe-area-inset-bottom)] lg:hidden"
        />
      }
    >
      <TavernNavInner campaignId={props.campaignId} />
    </Suspense>
  )
}
