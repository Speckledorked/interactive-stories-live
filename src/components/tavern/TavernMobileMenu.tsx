// Slide-out drawer reachable from the hamburger icon on every tavern-themed
// page. Surfaces everything that doesn't fit on the 5-item bottom nav:
// Help, Tutorial, contextual Wiki/Admin links, and Log Out (previously
// there was no reachable logout button anywhere in the redesigned app).

'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { X, Beer, Settings as SettingsIcon, HelpCircle, BookOpen, ScrollText, ShieldCheck, LogOut } from 'lucide-react'
import { displayFont } from '@/lib/tavernTheme'
import { logout } from '@/lib/clientAuth'

interface TavernMobileMenuProps {
  isOpen: boolean
  onClose: () => void
  campaignId?: string
  isAdmin?: boolean
}

export function TavernMobileMenu({ isOpen, onClose, campaignId, isAdmin = false }: TavernMobileMenuProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleLogout = () => {
    onClose()
    logout()
  }

  const links = [
    { href: '/campaigns', label: 'Tavern', icon: Beer },
    ...(campaignId ? [{ href: `/campaigns/${campaignId}/wiki`, label: 'Wiki', icon: BookOpen }] : []),
    ...(campaignId && isAdmin ? [{ href: `/campaigns/${campaignId}/admin`, label: 'Admin', icon: ShieldCheck }] : []),
    { href: '/settings', label: 'Settings', icon: SettingsIcon },
    { href: '/tutorial', label: 'Tutorial', icon: ScrollText },
    { href: '/help', label: 'Help & Documentation', icon: HelpCircle },
  ]

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-gradient-to-br from-tavern-800 to-tavern-950 border-r border-ember-900/40 shadow-2xl shadow-black/50 flex flex-col animate-slide-up">
        <div className="flex items-center justify-between p-4 border-b border-ember-900/30">
          <h2 className={`${displayFont.className} text-lg text-ember-100`}>Menu</h2>
          <button onClick={onClose} className="p-2 -mr-2 text-ember-300/60 hover:text-ember-100 transition-colors" aria-label="Close menu">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={onClose}
              className="flex items-center gap-3 px-4 py-3 text-ember-200/80 hover:text-ember-100 hover:bg-white/5 transition-colors"
            >
              <link.icon className="w-5 h-5 flex-shrink-0" />
              <span>{link.label}</span>
            </Link>
          ))}
        </nav>

        <div className="border-t border-ember-900/30 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 text-wine-400 hover:text-wine-300 hover:bg-wine-900/10 transition-colors rounded-lg"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            <span>Log Out</span>
          </button>
        </div>
      </div>
    </div>
  )
}
