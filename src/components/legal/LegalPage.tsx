// src/components/legal/LegalPage.tsx
//
// Shared chrome for /terms and /privacy. Deliberately the same shape as
// /updates next door — full-bleed, one narrow column, a link back to the
// front page — because the realistic visitor arrived from the signup
// form's fine print and is going straight back to it.
//
// No TavernPage/TavernHeader: those mount the sidebar, the bottom bar and
// a notifications panel, all of which assume a signed-in player. Someone
// reading the terms before agreeing to them is by definition not that.

import Link from 'next/link'

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  /** Human-readable, not ISO — this is display copy, not data. */
  updated: string
  children: React.ReactNode
}) {
  return (
    <div className="-mx-4 -my-8">
      <section className="px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <Link href="/" className="text-sm text-myth-ink-muted underline hover:text-myth-ink">
            ← MythOS
          </Link>
          <h1 className="mt-6 font-display text-3xl text-myth-ink sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm text-myth-ink-faint">Last updated {updated}</p>

          <div className="mt-12 space-y-10">{children}</div>

          <p className="mt-16 border-t border-myth-border pt-8 text-sm text-myth-ink-faint">
            <Link href="/terms" className="underline hover:text-myth-ink-muted">
              Terms of Service
            </Link>
            <span className="mx-3">·</span>
            <Link href="/privacy" className="underline hover:text-myth-ink-muted">
              Privacy Policy
            </Link>
            <span className="mx-3">·</span>
            <Link href="/help" className="underline hover:text-myth-ink-muted">
              Help
            </Link>
          </p>
        </div>
      </section>
    </div>
  )
}

/** One numbered section. Kept here so both documents stay visually identical. */
export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-xl text-myth-ink">{heading}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-myth-ink-muted">{children}</div>
    </section>
  )
}
