// Top bar shared by every redesigned page — either the full "MythOS"
// wordmark (top-level pages) or a back arrow + page title (sub-pages).
//
// variant="myth" (opt-in, used only by the two MythOS-redesign pages)
// swaps the permanently-dark tavern chrome for a flat, theme-adaptive
// myth-surface bar with the Fraunces display font instead of Cinzel.
// Every other TavernHeader consumer keeps the unchanged default.

'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { Bell, UserCircle, Menu, ArrowLeft } from 'lucide-react'
import { displayFont } from '@/lib/tavernTheme'
import { getUser } from '@/lib/clientAuth'
import { TavernMobileMenu } from './TavernMobileMenu'
import { TavernSidebar } from './TavernSidebar'
import NotificationPanel from '@/components/notifications/NotificationPanel'
import { IconButton } from '@/components/ui/icon-button'

export function TavernHeader({
  title,
  backHref,
  wordmark = false,
  subrow,
  campaignId,
  isAdmin = false,
  variant = 'tavern',
  minimalHeaderAtDesktop = false,
}: {
  title?: string
  backHref?: string
  wordmark?: boolean
  subrow?: React.ReactNode
  campaignId?: string
  isAdmin?: boolean
  variant?: 'tavern' | 'myth'
  /** Opt-in: drop this header's background/border/blur at lg:, leaving
   * only a floating icon cluster — for pages whose sidebar (and, for the
   * lobby specifically, its own hero) already make the bar's title/subrow
   * redundant at desktop width. Do NOT set this on a page whose `subrow`
   * has no sidebar equivalent (e.g. wiki's category tabs, story's scene
   * tabs) — that subrow currently relies on inheriting this header's
   * background to stay legible over scrolling content. */
  minimalHeaderAtDesktop?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const user = getUser()
  const myth = variant === 'myth'

  // min-h/min-w-[44px]: this is a Link, so it can't route through
  // IconButton (which renders a <button>) — but it sits in the same row as
  // two IconButtons and has to match their hit area, not just their look.
  // At p-2.5 around a 20px glyph it was 40px, four short of comfortable.
  const iconButtonClass = myth
    ? 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-myth-ink-muted hover:bg-myth-surface-sunken hover:text-myth-ink transition-colors touch-manipulation'
    : 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-ember-300/80 hover:text-ember-200 transition-colors touch-manipulation'

  return (
    <>
    <header
      className={
        myth
          ? `fixed top-0 inset-x-0 lg:left-64 z-30 bg-myth-surface/90 backdrop-blur-md border-b border-myth-border ${minimalHeaderAtDesktop ? 'lg:border-none lg:bg-transparent lg:backdrop-blur-none' : ''}`
          : 'fixed top-0 inset-x-0 z-30 bg-black/60 backdrop-blur-md border-b border-ember-900/40'
      }
    >
      <div className={myth ? 'max-w-2xl lg:max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3' : 'max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3'}>
        {backHref ? (
          <Link
            href={backHref}
            className={myth ? `inline-flex min-h-[44px] min-w-[44px] -ml-2.5 items-center justify-center rounded-lg text-myth-ink-muted hover:bg-myth-surface-sunken hover:text-myth-ink transition-colors flex-shrink-0 touch-manipulation` : 'inline-flex min-h-[44px] min-w-[44px] -ml-2.5 items-center justify-center text-ember-300/80 hover:text-ember-200 transition-colors flex-shrink-0 touch-manipulation'}
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
        ) : (
          <div className="w-9 flex-shrink-0" />
        )}

        {wordmark ? (
          <div className={myth ? 'flex flex-col items-center lg:hidden' : 'flex flex-col items-center'}>
            <div className="flex items-center gap-3">
              <span className={myth ? 'text-myth-gold/50 text-xs tracking-widest' : 'text-ember-700/60 text-xs tracking-widest'}>◈──</span>
              <h1
                className={
                  myth
                    ? 'font-display text-2xl tracking-[0.15em] text-myth-gold'
                    : `${displayFont.className} text-2xl tracking-[0.15em] bg-gradient-to-b from-ember-200 to-ember-500 bg-clip-text text-transparent`
                }
              >
                MythOS
              </h1>
              <span className={myth ? 'text-myth-gold/50 text-xs tracking-widest' : 'text-ember-700/60 text-xs tracking-widest'}>──◈</span>
            </div>
            <p className={myth ? 'text-[11px] tracking-[0.2em] text-myth-gold/60 -mt-0.5' : 'text-[11px] tracking-[0.2em] text-ember-300/50 -mt-0.5'}>THE WORLD REMEMBERS.</p>
          </div>
        ) : (
          <h1
            className={
              myth
                ? 'font-display text-base sm:text-lg tracking-wide text-myth-ink truncate text-center flex-1 lg:hidden'
                : `${displayFont.className} text-base sm:text-lg tracking-wide text-ember-100 truncate text-center flex-1`
            }
          >
            {title}
          </h1>
        )}

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <IconButton
            icon={Bell}
            label="Notifications"
            variant={myth ? 'ghost' : undefined}
            className={myth ? undefined : 'text-ember-300/80 hover:text-ember-200'}
            onClick={() => setNotifOpen(true)}
          />
          <IconButton
            icon={Menu}
            label="Menu"
            variant={myth ? 'ghost' : undefined}
            className={myth ? undefined : 'text-ember-300/80 hover:text-ember-200'}
            onClick={() => setMenuOpen(true)}
          />
          <Link href="/settings" className={iconButtonClass} aria-label="Profile">
            <UserCircle className="w-5 h-5" />
          </Link>
        </div>
      </div>

      {subrow}
    </header>

    {myth && (
      <Suspense fallback={<aside className="fixed left-0 top-0 bottom-0 z-30 hidden w-64 border-r border-myth-border bg-myth-surface lg:block" />}>
        <TavernSidebar campaignId={campaignId} isAdmin={isAdmin} />
      </Suspense>
    )}
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
