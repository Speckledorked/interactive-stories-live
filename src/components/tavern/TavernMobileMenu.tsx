// Slide-out drawer reachable from the hamburger icon on every tavern-themed
// page. Surfaces everything that doesn't fit on the 5-item bottom nav:
// Help, Tutorial, contextual Wiki/Admin links, and Log Out (previously
// there was no reachable logout button anywhere in the redesigned app).
//
// variant="myth" (opt-in, used only by the two MythOS-redesign pages)
// swaps the dark gradient drawer for a flat myth-surface one. Every other
// consumer (via TavernHeader) keeps the unchanged default.

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { X, Beer, Settings as SettingsIcon, HelpCircle, BookOpen, ScrollText, ShieldCheck, LogOut, Users } from 'lucide-react'
import { displayFont } from '@/lib/tavernTheme'
import { logout } from '@/lib/clientAuth'
import { useEscapeKey } from '@/hooks/useEscapeKey'

interface TavernMobileMenuProps {
  isOpen: boolean
  onClose: () => void
  campaignId?: string
  isAdmin?: boolean
  variant?: 'tavern' | 'myth'
}

export function TavernMobileMenu({ isOpen, onClose, campaignId, isAdmin = false, variant = 'tavern' }: TavernMobileMenuProps) {
  const myth = variant === 'myth'
  const pathname = usePathname()

  useEscapeKey(onClose, isOpen)

  if (!isOpen) return null

  const handleLogout = () => {
    onClose()
    logout()
  }

  const globalLinks = [{ href: '/campaigns', label: 'Tavern', icon: Beer, isActive: pathname === '/campaigns' }]

  // Only ever non-empty inside a specific campaign — Wiki/Admin are scoped
  // to whichever campaignId this menu was mounted with, unlike the account
  // links below. Rendered under its own "Campaign" heading (mirroring
  // TavernSidebar's identical Campaign/Account split) so that scoping is
  // visible rather than silently mixed into one flat list.
  const campaignLinks = [
    ...(campaignId
      ? [{ href: `/campaigns/${campaignId}/wiki`, label: 'Wiki', icon: BookOpen, isActive: pathname.startsWith(`/campaigns/${campaignId}/wiki`) }]
      : []),
    ...(campaignId && isAdmin
      ? [{ href: `/campaigns/${campaignId}/admin`, label: 'Admin', icon: ShieldCheck, isActive: pathname.startsWith(`/campaigns/${campaignId}/admin`) }]
      : []),
  ]

  const accountLinks = [
    { href: '/friends', label: 'Friends', icon: Users, isActive: pathname === '/friends' },
    { href: '/settings', label: 'Settings', icon: SettingsIcon, isActive: pathname === '/settings' },
    { href: '/tutorial', label: 'Tutorial', icon: ScrollText, isActive: pathname === '/tutorial' },
    { href: '/help', label: 'Help & Documentation', icon: HelpCircle, isActive: pathname === '/help' },
  ]

  type MenuLink = { href: string; label: string; icon: typeof Beer; isActive: boolean }
  const renderLinkGroup = (group: MenuLink[]) => (
    <div className="space-y-0.5">
      {group.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          onClick={onClose}
          className={
            myth
              ? `flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                  link.isActive ? 'bg-myth-accent/10 text-myth-accent' : 'text-myth-ink-muted hover:bg-myth-surface-sunken hover:text-myth-ink'
                }`
              : `flex items-center gap-3 px-4 py-3 transition-colors ${
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

  return (
    <div className="fixed inset-0 z-50">
      <div className={myth ? 'absolute inset-0 bg-black/50 backdrop-blur-sm' : 'absolute inset-0 bg-black/70 backdrop-blur-sm'} onClick={onClose} />
      <div
        className={
          myth
            ? 'absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-myth-surface-raised border-r border-myth-border shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.16)] flex flex-col animate-slide-up'
            : 'absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-gradient-to-br from-tavern-800 to-tavern-950 border-r border-ember-900/40 shadow-2xl shadow-black/50 flex flex-col animate-slide-up'
        }
      >
        <div className={myth ? 'flex items-center justify-between p-4 border-b border-myth-border' : 'flex items-center justify-between p-4 border-b border-ember-900/30'}>
          <h2 className={myth ? 'font-display text-lg text-myth-ink' : `${displayFont.className} text-lg text-ember-100`}>Menu</h2>
          <button
            onClick={onClose}
            className={myth ? 'p-2 -mr-2 text-myth-ink-faint hover:text-myth-ink transition-colors' : 'p-2 -mr-2 text-ember-300/60 hover:text-ember-100 transition-colors'}
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className={myth ? 'flex-1 space-y-4 overflow-y-auto p-2' : 'flex-1 space-y-0.5 overflow-y-auto p-2'}>
          {renderLinkGroup(globalLinks)}
          {campaignLinks.length > 0 && (
            <div>
              {myth && <p className="mb-1 px-3 font-mono text-xs uppercase tracking-wider text-myth-ink-faint">Campaign</p>}
              {renderLinkGroup(campaignLinks)}
            </div>
          )}
          <div>
            {myth && <p className="mb-1 px-3 font-mono text-xs uppercase tracking-wider text-myth-ink-faint">Account</p>}
            {renderLinkGroup(accountLinks)}
          </div>
        </nav>

        <div className={myth ? 'border-t border-myth-border p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]' : 'border-t border-ember-900/30 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]'}>
          <button
            onClick={handleLogout}
            className={
              myth
                ? 'w-full flex items-center gap-3 px-4 py-3 text-myth-danger hover:bg-myth-danger/10 transition-colors rounded-lg'
                : 'w-full flex items-center gap-3 px-4 py-3 text-wine-400 hover:text-wine-300 hover:bg-wine-900/10 transition-colors rounded-lg'
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
