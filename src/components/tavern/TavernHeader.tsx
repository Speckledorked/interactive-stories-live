// Top bar shared by every redesigned page — either the full "MythOS"
// wordmark (top-level pages) or a back arrow + page title (sub-pages).
//
// A flat, theme-adaptive myth-surface bar in the Fraunces display font.
// It used to carry a `variant` prop selecting between this and a
// permanently-dark tavern chrome in Cinzel; every page is on the myth
// system now, so that branch had no callers and is gone.

'use client'

import { useState, useSyncExternalStore, useEffect, useRef, Suspense } from 'react'
import Link from 'next/link'
import { Bell, UserCircle, Menu, ArrowLeft } from 'lucide-react'
import { getUser } from '@/lib/clientAuth'
import { TavernMobileMenu } from './TavernMobileMenu'
import { useUnreadCount } from '@/hooks/useUnreadCount'
import {
  closeMobileMenu,
  getMobileMenuOpen,
  getMobileMenuServerSnapshot,
  openMobileMenu,
  subscribeMobileMenu,
} from './mobileMenuStore'
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
  minimalHeaderAtDesktop = false,
}: {
  title?: string
  backHref?: string
  wordmark?: boolean
  subrow?: React.ReactNode
  campaignId?: string
  isAdmin?: boolean
  /** Opt-in: drop this header's background/border/blur at lg:, leaving
   * only a floating icon cluster — for pages whose sidebar (and, for the
   * lobby specifically, its own hero) already make the bar's title/subrow
   * redundant at desktop width. Do NOT set this on a page whose `subrow`
   * has no sidebar equivalent (e.g. wiki's category tabs, story's scene
   * tabs) — that subrow currently relies on inheriting this header's
   * background to stay legible over scrolling content. */
  minimalHeaderAtDesktop?: boolean
}) {
  // The drawer's open state lives in a module store rather than here,
  // because TavernNav's "More" tab opens the same drawer from a sibling
  // subtree this component can't reach (see mobileMenuStore.ts).
  const menuOpen = useSyncExternalStore(subscribeMobileMenu, getMobileMenuOpen, getMobileMenuServerSnapshot)
  const [notifOpen, setNotifOpen] = useState(false)
  const unreadCount = useUnreadCount()
  const user = getUser()

  // This header is `fixed`, so it contributes no flow height and every page
  // has to pad its own content clear of it. That used to be a hardcoded
  // `pt-28` (112px) on all 14 pages — a guess that silently drifted: a bar
  // carrying a `subrow` actually measures 122px (128 on the story page), so
  // the first line of content sat *under* the bar on every subrow page.
  //
  // A static number can't be right for a bar whose height depends on the
  // variant, the subrow, and the breakpoint, so it publishes its measured
  // height instead and pages offset by it (see headerOffset.ts). Nothing
  // can drift out of sync with a value that's measured rather than assumed.
  const headerRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = headerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const publish = () => {
      document.documentElement.style.setProperty('--myth-header-h', `${Math.round(el.getBoundingClientRect().height)}px`)
    }
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // min-h/min-w-[44px]: this is a Link, so it can't route through
  // IconButton (which renders a <button>) — but it sits in the same row as
  // two IconButtons and has to match their hit area, not just their look.
  // At p-2.5 around a 20px glyph it was 40px, four short of comfortable.
  const iconButtonClass =
    'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-myth-ink-muted hover:bg-myth-surface-sunken hover:text-myth-ink transition-colors touch-manipulation'

  return (
    <>
    <header
      ref={headerRef}
      className={`fixed top-0 inset-x-0 lg:left-64 z-30 bg-myth-surface/90 backdrop-blur-md border-b border-myth-border ${minimalHeaderAtDesktop ? 'lg:border-none lg:bg-transparent lg:backdrop-blur-none' : ''}`}
    >
      <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        {backHref ? (
          <Link
            href={backHref}
            className="inline-flex min-h-[44px] min-w-[44px] -ml-2.5 items-center justify-center rounded-lg text-myth-ink-muted hover:bg-myth-surface-sunken hover:text-myth-ink transition-colors flex-shrink-0 touch-manipulation"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
        ) : (
          <div className="w-9 flex-shrink-0" />
        )}

        {wordmark ? (
          // min-w-0 so this can shrink: the row is spacer + wordmark +
          // a flex-shrink-0 icon cluster, and at 390px the full wordmark
          // (191px) pushed the cluster's last item ~25px off-screen —
          // the Profile link was literally unreachable on a phone. The
          // ◈── flourishes are decoration, so they're the part that goes
          // first; the name itself stays.
          <div className="flex min-w-0 flex-col items-center lg:hidden">
            <div className="flex min-w-0 items-center gap-3">
              <span aria-hidden className="hidden text-myth-gold/50 text-xs tracking-widest sm:inline">◈──</span>
              <h1
                className="truncate font-display text-2xl tracking-[0.15em] text-myth-gold"
              >
                MythOS
              </h1>
              <span aria-hidden className="hidden text-myth-gold/50 text-xs tracking-widest sm:inline">──◈</span>
            </div>
            <p className="truncate text-[11px] tracking-[0.2em] text-myth-gold -mt-0.5">THE WORLD REMEMBERS.</p>
          </div>
        ) : (
          <h1
            className="font-display text-base sm:text-lg tracking-wide text-myth-ink truncate text-center flex-1 lg:hidden"
          >
            {title}
          </h1>
        )}

        <div className="flex items-center gap-2 flex-shrink-0">
          <IconButton
            icon={Bell}
            label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            badge={unreadCount}
            variant="ghost"
            onClick={() => setNotifOpen(true)}
          />
          <IconButton
            icon={Menu}
            label="Menu"
            variant="ghost"
            onClick={openMobileMenu}
          />
          <Link href="/settings" className={iconButtonClass} aria-label="Profile">
            <UserCircle className="w-5 h-5" />
          </Link>
        </div>
      </div>

      {subrow}
    </header>

    <Suspense fallback={<aside className="fixed left-0 top-0 bottom-0 z-30 hidden w-64 border-r border-myth-border bg-myth-surface lg:block" />}>
      <TavernSidebar campaignId={campaignId} isAdmin={isAdmin} />
    </Suspense>
    <TavernMobileMenu isOpen={menuOpen} onClose={closeMobileMenu} campaignId={campaignId} isAdmin={isAdmin} />
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
