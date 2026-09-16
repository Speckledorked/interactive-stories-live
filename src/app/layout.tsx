// src/app/layout.tsx
// Root layout - wraps all pages

import type { Metadata, Viewport } from 'next'
import './globals.css'
import { CommandPaletteProvider } from '@/contexts/CommandPaletteContext'
import { ErrorHandlerInit } from './ErrorHandlerInit'
import { OrientationGate } from '@/components/tutorial/OrientationGate'
import { getAppUrl } from '@/lib/appUrl'
import { fontDisplay, fontSans, fontMono } from '@/lib/fonts'
import { THEME_INIT_SCRIPT } from '@/lib/theme'
import { AUTH_FLAG_INIT_SCRIPT } from '@/lib/authFlag'

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
  return (
    // suppressHydrationWarning because two scripts in <head> deliberately
    // write attributes onto this element before React hydrates: `data-theme`
    // and `data-signed-in`. The server cannot know either value — one lives
    // in localStorage, the other IS localStorage — so the markup diverging
    // from the DOM here is the design working, not a bug to be reported.
    // It suppresses one level only, which is exactly this element's own
    // attributes; children still get the normal mismatch checking.
    <html
      lang="en"
      suppressHydrationWarning
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
            has to be answered before paint too. See lib/authFlag.ts. */}
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
