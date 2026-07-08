// Top bar shared by every redesigned page — either the full "AI GM"
// wordmark (top-level pages) or a back arrow + page title (sub-pages).

'use client'

import Link from 'next/link'
import { Bell, UserCircle, Menu, ArrowLeft } from 'lucide-react'
import { displayFont } from '@/lib/tavernTheme'

export function TavernHeader({
  title,
  backHref,
  wordmark = false,
  subrow,
}: {
  title?: string
  backHref?: string
  wordmark?: boolean
  subrow?: React.ReactNode
}) {
  return (
    <header className="fixed top-0 inset-x-0 z-30 bg-black/60 backdrop-blur-md border-b border-ember-900/40">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        {backHref ? (
          <Link
            href={backHref}
            className="p-2 -ml-2 text-ember-300/80 hover:text-ember-200 transition-colors flex-shrink-0"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
        ) : (
          <button
            className="p-2 -ml-2 text-ember-300/80 hover:text-ember-200 transition-colors flex-shrink-0"
            aria-label="Menu"
            title="Menu (not wired up yet)"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        {wordmark ? (
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-3">
              <span className="text-ember-700/60 text-xs tracking-widest">◈──</span>
              <h1
                className={`${displayFont.className} text-2xl tracking-[0.15em] bg-gradient-to-b from-ember-200 to-ember-500 bg-clip-text text-transparent`}
              >
                AI GM
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

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            className="p-2 text-ember-300/80 hover:text-ember-200 transition-colors"
            aria-label="Notifications"
            title="Notifications (not wired up yet)"
          >
            <Bell className="w-5 h-5" />
          </button>
          <Link href="/settings" className="p-2 text-ember-300/80 hover:text-ember-200 transition-colors" aria-label="Profile">
            <UserCircle className="w-5 h-5" />
          </Link>
        </div>
      </div>

      {subrow}
    </header>
  )
}
