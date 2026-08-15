// Persistent left navigation for wide viewports (lg:+), mounted only for
// variant="myth" pages (see TavernHeader, which owns mounting this
// alongside TavernMobileMenu). Below lg:, this renders nothing — mobile
// keeps TavernNav's bottom tab bar + TavernMobileMenu's drawer exactly as
// before. Reuses the same link destinations/icons those two already
// define rather than inventing a second navigation vocabulary.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  Beer,
  Home,
  Scroll,
  MessageSquare,
  StickyNote,
  Map as MapIcon,
  Users,
  BookOpen,
  ShieldCheck,
  HelpCircle,
  ScrollText,
  Settings as SettingsIcon,
  LogOut,
} from 'lucide-react'
import { authenticatedFetch, logout } from '@/lib/clientAuth'

interface CampaignIdentity {
  title: string
  universe: string | null
  turnNumber: number
  inGameDate: string | null
}

interface NavLink {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  isActive: (pathname: string, tab: string | null) => boolean
}

export function TavernSidebar({
  campaignId,
  isAdmin = false,
}: {
  campaignId?: string
  isAdmin?: boolean
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab')

  const campaignHome = campaignId ? `/campaigns/${campaignId}` : null
  const isCampaignHome = campaignHome !== null && pathname === campaignHome

  // Small campaign-identity summary shown below the nav list — the
  // sidebar otherwise only carries links, never the campaign's own
  // title/genre/turn/date, unlike the lobby hero which already has all
  // of it. One lightweight fetch on mount against the existing campaign
  // GET route (no new endpoint); silently renders nothing on failure,
  // same graceful-degradation convention as the lobby's own widgets.
  const [identity, setIdentity] = useState<CampaignIdentity | null>(null)
  useEffect(() => {
    if (!campaignId) {
      setIdentity(null)
      return
    }
    authenticatedFetch(`/api/campaigns/${campaignId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.campaign) return
        setIdentity({
          title: data.campaign.title,
          universe: data.campaign.universe ?? null,
          turnNumber: data.campaign.worldMeta?.currentTurnNumber ?? 0,
          inGameDate: data.campaign.worldMeta?.currentInGameDate ?? null,
        })
      })
      .catch(() => {})
  }, [campaignId])

  const globalLinks: NavLink[] = [
    { href: '/campaigns', label: 'Campaigns', icon: Beer, isActive: (p) => p === '/campaigns' },
  ]

  const campaignLinks: NavLink[] = campaignHome
    ? [
        { href: campaignHome, label: 'Overview', icon: Home, isActive: () => isCampaignHome && !tab },
        {
          href: `${campaignHome}?tab=progression`,
          label: 'Story Log',
          icon: Scroll,
          isActive: () => isCampaignHome && tab === 'progression',
        },
        {
          href: `${campaignHome}?tab=chat`,
          label: 'Chat',
          icon: MessageSquare,
          isActive: () => isCampaignHome && tab === 'chat',
        },
        {
          href: `${campaignHome}?tab=notes`,
          label: 'Notes',
          icon: StickyNote,
          isActive: () => isCampaignHome && tab === 'notes',
        },
        {
          href: `${campaignHome}?tab=maps`,
          label: 'Maps',
          icon: MapIcon,
          isActive: () => isCampaignHome && tab === 'maps',
        },
        {
          href: `${campaignHome}/characters`,
          label: 'Characters',
          icon: Users,
          isActive: (p) => p.startsWith(`${campaignHome}/characters`),
        },
        {
          href: `${campaignHome}/quests`,
          label: 'Quests',
          icon: ScrollText,
          isActive: (p) => p.startsWith(`${campaignHome}/quests`),
        },
        {
          href: `${campaignHome}/wiki`,
          label: 'Wiki',
          icon: BookOpen,
          isActive: (p) => p.startsWith(`${campaignHome}/wiki`),
        },
        ...(isAdmin
          ? [
              {
                href: `${campaignHome}/admin`,
                label: 'Admin',
                icon: ShieldCheck,
                isActive: (p: string) => p.startsWith(`${campaignHome}/admin`),
              },
            ]
          : []),
      ]
    : []

  const accountLinks: NavLink[] = [
    { href: '/friends', label: 'Friends', icon: Users, isActive: (p) => p === '/friends' },
    { href: '/settings', label: 'Settings', icon: SettingsIcon, isActive: (p) => p === '/settings' },
    { href: '/tutorial', label: 'Tutorial', icon: ScrollText, isActive: (p) => p === '/tutorial' },
    { href: '/help', label: 'Help & Documentation', icon: HelpCircle, isActive: (p) => p === '/help' },
  ]

  const renderLink = (link: NavLink) => {
    const active = link.isActive(pathname, tab)
    return (
      <Link
        key={link.href}
        href={link.href}
        className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
          active
            ? 'bg-myth-accent/10 text-myth-accent'
            : 'text-myth-ink-muted hover:bg-myth-surface-sunken hover:text-myth-ink'
        }`}
      >
        <link.icon className="h-4 w-4 flex-shrink-0" />
        <span className="truncate uppercase tracking-wide">{link.label}</span>
      </Link>
    )
  }

  return (
    <aside className="fixed left-0 top-0 bottom-0 z-30 hidden w-64 flex-col border-r border-myth-border bg-myth-surface lg:flex">
      <div className="flex flex-col items-center gap-3 border-b border-myth-gold/20 px-4 py-5">
        <div className="flex items-center gap-3">
          <span className="text-xs tracking-widest text-myth-gold/50">◈──</span>
          <h1 className="font-display text-xl tracking-[0.15em] text-myth-gold">MythOS</h1>
          <span className="text-xs tracking-widest text-myth-gold/50">──◈</span>
        </div>
        <p className="-mt-2 text-[11px] tracking-[0.2em] text-myth-gold/60">THE WORLD REMEMBERS.</p>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        <div className="space-y-1">{globalLinks.map(renderLink)}</div>

        {campaignLinks.length > 0 && (
          <div>
            <p className="mb-1 px-3 font-mono text-xs uppercase tracking-wider text-myth-ink-faint">Campaign</p>
            <div className="space-y-1">{campaignLinks.map(renderLink)}</div>
          </div>
        )}

        {identity && (
          <div className="rounded-lg border border-myth-border bg-myth-surface-raised px-3 py-3">
            <p className="truncate font-display text-sm font-semibold text-myth-ink">{identity.title}</p>
            {identity.universe && <p className="mt-0.5 truncate text-xs italic text-myth-ink-faint">{identity.universe}</p>}
            <p className="mt-2 font-mono text-xs text-myth-ink-muted">
              Turn {identity.turnNumber}
              {identity.inGameDate ? ` · ${identity.inGameDate}` : ''}
            </p>
          </div>
        )}

        <div>
          <p className="mb-1 px-3 font-mono text-xs uppercase tracking-wider text-myth-ink-faint">Account</p>
          <div className="space-y-1">{accountLinks.map(renderLink)}</div>
        </div>
      </nav>

      <div className="border-t border-myth-border p-2">
        <button
          onClick={() => logout()}
          className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-myth-danger transition-colors hover:bg-myth-danger/10"
        >
          <LogOut className="h-4 w-4 flex-shrink-0" />
          <span>Log Out</span>
        </button>
      </div>
    </aside>
  )
}
