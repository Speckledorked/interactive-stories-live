// src/app/layout.tsx
// Root layout - wraps all pages

import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import './globals.css'
import { CommandPaletteProvider } from '@/contexts/CommandPaletteContext'
import { ErrorHandlerInit } from './ErrorHandlerInit'
import { OrientationGate } from '@/components/tutorial/OrientationGate'
import { getAppUrl } from '@/lib/appUrl'
import { fontDisplay, fontSans, fontMono } from '@/lib/fonts'
import { THEME_INIT_SCRIPT } from '@/lib/theme'
import { AUTH_FLAG_INIT_SCRIPT } from '@/lib/authFlag'
import { ACCESS_TOKEN_COOKIE, verifyToken } from '@/lib/auth'

// Reading the session cookie here opts every page into per-request
// rendering (no static prerender). That is the price of answering "is
// anyone signed in" from the cookie instead of a client hint: the whole
// app past the landing page is authenticated and database-backed anyway,
// so nothing else loses anything.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  metadataBase: new URL(getAppUrl()),
  title: 'MythOS',
  description: 'The world remembers. Play tabletop RPGs with MythOS.',
  openGraph: {
    title: 'MythOS',
    description: 'The world remembers.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MythOS',
    description: 'The world remembers.',
  },
}

export const viewport: Viewport = {
  // Was a single hard-coded '#0c0705' (old tavern near-black), which on a
  // phone painted the browser chrome dark even for a light-mode user.
  // These two are --myth-canvas in each theme.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f3ec' },
    { media: '(prefers-color-scheme: dark)', color: '#14110d' },
  ],
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // The session lives in httpOnly cookies, which the server CAN read on
  // the page request itself (unlike the browser). verifyToken is
  // signature-and-expiry only — synchronous, no database — so this costs
  // nothing per request. It is a display hint, not an auth decision: a
  // revoked-but-unexpired token still renders the signed-in call to
  // action, and /campaigns guards itself server-side regardless.
  // The inline script below stays as the client-side-navigation fallback:
  // App Router navigations do not re-run the root layout, so after a
  // login/logout without a full reload the script's localStorage hint is
  // what keeps the attribute current.
  const accessToken = cookies().get(ACCESS_TOKEN_COOKIE)?.value
  const signedIn = accessToken != null && verifyToken(accessToken) !== null
  return (
    // suppressHydrationWarning because the <head> scripts deliberately
    // write attributes onto this element before React hydrates:
    // `data-theme` (localStorage, which the server truly cannot know)
    // and `data-signed-in` (the script's hint can disagree with the
    // server-rendered value when the hint is stale — the script runs
    // before paint and wins, which is the designed precedence).
    // It suppresses one level only, which is exactly this element's own
    // attributes; children still get the normal mismatch checking.
    <html
      lang="en"
      suppressHydrationWarning
      data-signed-in={signedIn ? '' : undefined}
      className={`${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable}`}
    >
      <head>
        {/* Must run before first paint so an explicit light/dark choice is
            applied without a flash of the other palette. See
            src/lib/theme.ts for why this is an inline string rather than
            a component effect. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Same reasoning one layer along: the landing page renders both
            calls to action and CSS picks one, so "is anyone signed in"
            has to be answered before paint too. The server sets the
            initial value from the access cookie (see the layout); this
            script keeps it current across client-side navigations, where
            the layout does not re-run. See lib/authFlag.ts. */}
        <script dangerouslySetInnerHTML={{ __html: AUTH_FLAG_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-myth-canvas text-myth-ink">
        <ErrorHandlerInit />
        {/* Shows the "what is this" intro once per user, on whatever
            authenticated page they load first. Renders nothing when
            signed out, so /login and /signup are unaffected without a
            route allowlist. */}
        <OrientationGate />
        <CommandPaletteProvider>
          <main className="container mx-auto px-4 py-8">
            {children}
          </main>
        </CommandPaletteProvider>
      </body>
    </html>
  )
}
