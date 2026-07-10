// Top bar shared by every redesigned page — either the full "MythOS"
// wordmark (top-level pages) or a back arrow + page title (sub-pages).

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Bell, UserCircle, Menu, ArrowLeft } from 'lucide-react'
import { displayFont } from '@/lib/tavernTheme'
import { getUser } from '@/lib/clientAuth'
import { TavernMobileMenu } from './TavernMobileMenu'
import NotificationPanel from '@/components/notifications/NotificationPanel'

export function TavernHeader({
  title,
  backHref,
  wordmark = false,
  subrow,
  campaignId,
  isAdmin = false,
}: {
  title?: string
  backHref?: string
  wordmark?: boolean
  subrow?: React.ReactNode
  campaignId?: string
  isAdmin?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const user = getUser()

  return (
    <>
    <header className="fixed top-0 inset-x-0 z-30 bg-black/60 backdrop-blur-md border-b border-ember-900/40">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        {backHref ? (
          <Link
            href={backHref}
            className="p-2.5 -ml-2.5 text-ember-300/80 hover:text-ember-200 transition-colors flex-shrink-0 touch-manipulation"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
        ) : (
          <div className="w-9 flex-shrink-0" />
        )}

        {wordmark ? (
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-3">
              <span className="text-ember-700/60 text-xs tracking-widest">◈──</span>
              <h1
                className={`${displayFont.className} text-2xl tracking-[0.15em] bg-gradient-to-b from-ember-200 to-ember-500 bg-clip-text text-transparent`}
              >
                MythOS
              </h1>
              <span className="text-ember-700/60 text-xs tracking-widest">──◈</span>
            </div>
            <p className="text-[11px] tracking-[0.2em] text-ember-300/50 -mt-0.5">YOUR STORY. THE WORLD.</p>
          </div>
        ) : (
          <h1 className={`${displayFont.className} text-base sm:text-lg tracking-wide text-ember-100 truncate text-center flex-1`}>
            {title}
          </h1>
        )}

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => setNotifOpen(true)}
            className="p-2.5 -m-0.5 text-ember-300/80 hover:text-ember-200 transition-colors touch-manipulation"
            aria-label="Notifications"
          >
            <Bell className="w-5 h-5" />
          </button>
          <button
            onClick={() => setMenuOpen(true)}
            className="p-2.5 -m-0.5 text-ember-300/80 hover:text-ember-200 transition-colors touch-manipulation"
            aria-label="Menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <Link href="/settings" className="p-2.5 -m-0.5 text-ember-300/80 hover:text-ember-200 transition-colors touch-manipulation" aria-label="Profile">
            <UserCircle className="w-5 h-5" />
          </Link>
        </div>
      </div>

      {subrow}
    </header>

    <TavernMobileMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} campaignId={campaignId} isAdmin={isAdmin} />
    {user && (
      <NotificationPanel
        userId={user.id}
        campaignId={campaignId}
        isOpen={notifOpen}
        onClose={() => setNotifOpen(false)}
      />
    )}
    </>
  )
}
