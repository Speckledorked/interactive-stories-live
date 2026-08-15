// Slide-out drawer, opened from the header's hamburger and from the
// bottom bar's "More" tab (both go through mobileMenuStore).
//
// This is the mobile overflow nav, and that job is load-bearing: the
// bottom bar only has five slots, and TavernSidebar lists eleven
// destinations at `lg:+`. docs/design-system.md requires the mobile
// surfaces to reach everything the sidebar does, so everything that
// doesn't fit on the bar lives here, grouped the same way the sidebar
// groups it:
//
//   World     — the campaign's world views (Factions, Locations,
//               Threads, Maps, Wiki)
//   Campaign  — the campaign's own sections (Story Log, Chat, Notes,
//               Admin)
//   Account   — everything not scoped to a campaign, plus Log Out
//
// World/Campaign are only ever non-empty inside a specific campaign;
// they're scoped to whichever campaignId this drawer was mounted with,
// unlike the account links. Rendering them under their own headings
// makes that scoping visible rather than silently mixing it into one
// flat list.
//
// variant="myth" (opt-in) swaps the dark gradient drawer for a flat
// myth-surface one. Every other consumer keeps the unchanged default.
//
// useSearchParams() is needed because the lobby's sections are `?tab=`
// state on one route, and it opts a page out of static prerendering
// unless it sits under a Suspense boundary — so the hook-using body is
// wrapped here rather than at each of the callers.

'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  X,
  Home,
  Swords,
  Landmark,
  Clock,
  Map as MapIcon,
  Settings as SettingsIcon,
  HelpCircle,
  BookOpen,
  ScrollText,
  ShieldCheck,
  LogOut,
  Users,
  MessageSquare,
  StickyNote,
} from 'lucide-react'
import { displayFont } from '@/lib/tavernTheme'
import { logout } from '@/lib/clientAuth'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { IconButton } from '@/components/ui/icon-button'

interface TavernMobileMenuProps {
  isOpen: boolean
  onClose: () => void
  campaignId?: string
  isAdmin?: boolean
  variant?: 'tavern' | 'myth'
}

type MenuLink = { href: string; label: string; icon: typeof Home; isActive: boolean }

function TavernMobileMenuInner({
  isOpen,
  onClose,
  campaignId,
  isAdmin = false,
  variant = 'tavern',
}: TavernMobileMenuProps) {
  const myth = variant === 'myth'
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab')

  useEscapeKey(onClose, isOpen)

  if (!isOpen) return null

  const handleLogout = () => {
    onClose()
    logout()
  }

  const home = campaignId ? `/campaigns/${campaignId}` : null
  const onLobby = home !== null && pathname === home
  const lobbyTab = (key: string, label: string, icon: typeof Home): MenuLink => ({
    href: `${home}?tab=${key}`,
    label,
    icon,
    isActive: onLobby && tab === key,
  })
  // Live entities live on /world's `?type=` tabs; the Codex link below
  // keeps /wiki. Both surfaces redirect the other's types, so an older
  // bookmark still lands correctly — but linking straight to the right one
  // avoids a redirect hop the user would see as a flash.
  const worldType = (type: string, label: string, icon: typeof Home): MenuLink => ({
    href: `${home}/world?type=${type}`,
    label,
    icon,
    isActive: pathname.startsWith(`${home}/world`) && searchParams.get('type') === type,
  })

  const worldLinks: MenuLink[] = home
    ? [
        worldType('FACTION', 'Factions', Swords),
        worldType('LOCATION', 'Locations', Landmark),
        worldType('CLOCK', 'Threads', Clock),
        lobbyTab('maps', 'Maps', MapIcon),
        {
          href: `${home}/wiki`,
          label: 'Codex',
          icon: BookOpen,
          // Only the bare wiki, so it doesn't light up alongside the three
          // `?type=` entries above.
          isActive: pathname.startsWith(`${home}/wiki`) && searchParams.get('type') === null,
        },
      ]
    : []

  const campaignLinks: MenuLink[] = home
    ? [
        lobbyTab('progression', 'Story Log', ScrollText),
        lobbyTab('chat', 'Chat', MessageSquare),
        lobbyTab('notes', 'Notes', StickyNote),
        ...(isAdmin
          ? [
              {
                href: `${home}/admin`,
                label: 'Admin',
                icon: ShieldCheck,
                isActive: pathname.startsWith(`${home}/admin`),
              },
            ]
          : []),
      ]
    : []

  const accountLinks: MenuLink[] = [
    { href: '/campaigns', label: 'All Campaigns', icon: Home, isActive: pathname === '/campaigns' },
    { href: '/friends', label: 'Friends', icon: Users, isActive: pathname === '/friends' },
    { href: '/settings', label: 'Settings', icon: SettingsIcon, isActive: pathname === '/settings' },
    { href: '/tutorial', label: 'Tutorial', icon: ScrollText, isActive: pathname === '/tutorial' },
    { href: '/help', label: 'Help & Documentation', icon: HelpCircle, isActive: pathname === '/help' },
  ]

  const renderLinkGroup = (group: MenuLink[]) => (
    <div className="space-y-0.5">
      {group.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          onClick={onClose}
          className={
            myth
              ? `flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                  link.isActive
                    ? 'bg-myth-accent/10 text-myth-accent'
                    : 'text-myth-ink-muted hover:bg-myth-surface-sunken hover:text-myth-ink'
                }`
              : `flex min-h-[44px] items-center gap-3 px-4 py-3 transition-colors ${
                  link.isActive ? 'text-ember-100' : 'text-ember-200/80 hover:text-ember-100 hover:bg-white/5'
                }`
          }
        >
          <link.icon className="w-5 h-5 flex-shrink-0" />
          <span className={myth ? 'uppercase tracking-wide' : ''}>{link.label}</span>
        </Link>
      ))}
    </div>
  )

  const renderSection = (label: string, group: MenuLink[]) =>
    group.length === 0 ? null : (
      <div>
        {myth && <p className="mb-1 px-3 font-mono text-xs uppercase tracking-wider text-myth-ink-faint">{label}</p>}
        {renderLinkGroup(group)}
      </div>
    )

  return (
    <div className="fixed inset-0 z-50">
      <div
        className={myth ? 'absolute inset-0 bg-black/50 backdrop-blur-sm' : 'absolute inset-0 bg-black/70 backdrop-blur-sm'}
        onClick={onClose}
      />
      <div
        className={
          myth
            ? 'absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-myth-surface-raised border-r border-myth-border shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.16)] flex flex-col animate-slide-up'
            : 'absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-gradient-to-br from-tavern-800 to-tavern-950 border-r border-ember-900/40 shadow-2xl shadow-black/50 flex flex-col animate-slide-up'
        }
      >
        <div
          className={
            myth
              ? 'flex items-center justify-between p-4 border-b border-myth-border'
              : 'flex items-center justify-between p-4 border-b border-ember-900/30'
          }
        >
          <h2 className={myth ? 'font-display text-lg text-myth-ink' : `${displayFont.className} text-lg text-ember-100`}>Menu</h2>
          <IconButton
            icon={X}
            label="Close menu"
            className={myth ? '-mr-2' : '-mr-2 text-ember-300/60 hover:text-ember-100'}
            onClick={onClose}
          />
        </div>

        <nav className={myth ? 'flex-1 space-y-4 overflow-y-auto p-2' : 'flex-1 space-y-0.5 overflow-y-auto p-2'}>
          {renderSection('World', worldLinks)}
          {renderSection('Campaign', campaignLinks)}
          {renderSection('Account', accountLinks)}
        </nav>

        <div
          className={
            myth
              ? 'border-t border-myth-border p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]'
              : 'border-t border-ember-900/30 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]'
          }
        >
          <button
            onClick={handleLogout}
            className={
              myth
                ? 'w-full flex min-h-[44px] items-center gap-3 px-4 py-3 text-myth-danger hover:bg-myth-danger/10 transition-colors rounded-lg'
                : 'w-full flex min-h-[44px] items-center gap-3 px-4 py-3 text-wine-400 hover:text-wine-300 hover:bg-wine-900/10 transition-colors rounded-lg'
            }
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            <span>Log Out</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export function TavernMobileMenu(props: TavernMobileMenuProps) {
  return (
    <Suspense fallback={null}>
      <TavernMobileMenuInner {...props} />
    </Suspense>
  )
}
