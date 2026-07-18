// Top bar shared by every redesigned page — either the full "MythOS"
// wordmark (top-level pages) or a back arrow + page title (sub-pages).
//
// variant="myth" (opt-in, used only by the two MythOS-redesign pages)
// swaps the permanently-dark tavern chrome for a flat, theme-adaptive
// myth-surface bar with the Fraunces display font instead of Cinzel.
// Every other TavernHeader consumer keeps the unchanged default.

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
  variant = 'tavern',
}: {
  title?: string
  backHref?: string
  wordmark?: boolean
  subrow?: React.ReactNode
  campaignId?: string
  isAdmin?: boolean
  variant?: 'tavern' | 'myth'
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const user = getUser()
  const myth = variant === 'myth'

  const iconButtonClass = myth
    ? 'p-2.5 -m-0.5 text-myth-ink-muted hover:text-myth-ink transition-colors touch-manipulation'
    : 'p-2.5 -m-0.5 text-ember-300/80 hover:text-ember-200 transition-colors touch-manipulation'

  return (
    <>
    <header
      className={
        myth
          ? 'fixed top-0 inset-x-0 z-30 bg-myth-surface/90 backdrop-blur-md border-b border-myth-border'
          : 'fixed top-0 inset-x-0 z-30 bg-black/60 backdrop-blur-md border-b border-ember-900/40'
      }
    >
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        {backHref ? (
          <Link
            href={backHref}
            className={myth ? `p-2.5 -ml-2.5 text-myth-ink-muted hover:text-myth-ink transition-colors flex-shrink-0 touch-manipulation` : 'p-2.5 -ml-2.5 text-ember-300/80 hover:text-ember-200 transition-colors flex-shrink-0 touch-manipulation'}
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
              <span className={myth ? 'text-myth-ink-faint text-xs tracking-widest' : 'text-ember-700/60 text-xs tracking-widest'}>◈──</span>
              <h1
                className={
                  myth
                    ? 'font-display text-2xl tracking-[0.15em] text-myth-ink'
                    : `${displayFont.className} text-2xl tracking-[0.15em] bg-gradient-to-b from-ember-200 to-ember-500 bg-clip-text text-transparent`
                }
              >
                MythOS
              </h1>
              <span className={myth ? 'text-myth-ink-faint text-xs tracking-widest' : 'text-ember-700/60 text-xs tracking-widest'}>──◈</span>
            </div>
            <p className={myth ? 'text-[11px] tracking-[0.2em] text-myth-ink-faint -mt-0.5' : 'text-[11px] tracking-[0.2em] text-ember-300/50 -mt-0.5'}>THE WORLD REMEMBERS.</p>
          </div>
        ) : (
          <h1
            className={
              myth
                ? 'font-display text-base sm:text-lg tracking-wide text-myth-ink truncate text-center flex-1'
                : `${displayFont.className} text-base sm:text-lg tracking-wide text-ember-100 truncate text-center flex-1`
            }
          >
            {title}
          </h1>
        )}

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button onClick={() => setNotifOpen(true)} className={iconButtonClass} aria-label="Notifications">
            <Bell className="w-5 h-5" />
          </button>
          <button onClick={() => setMenuOpen(true)} className={iconButtonClass} aria-label="Menu">
            <Menu className="w-5 h-5" />
          </button>
          <Link href="/settings" className={iconButtonClass} aria-label="Profile">
            <UserCircle className="w-5 h-5" />
          </Link>
        </div>
      </div>

      {subrow}
    </header>

    <TavernMobileMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} campaignId={campaignId} isAdmin={isAdmin} variant={variant} />
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
