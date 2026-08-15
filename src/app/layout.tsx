// src/app/layout.tsx
// Root layout - wraps all pages

import type { Metadata, Viewport } from 'next'
import './globals.css'
import { CommandPaletteProvider } from '@/contexts/CommandPaletteContext'
import { ErrorHandlerInit } from './ErrorHandlerInit'
import { getAppUrl } from '@/lib/appUrl'
import { fontDisplay, fontSans, fontMono } from '@/lib/fonts'
import { THEME_INIT_SCRIPT } from '@/lib/theme'

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
    <html lang="en" className={`${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable}`}>
      <head>
        {/* Must run before first paint so an explicit light/dark choice is
            applied without a flash of the other palette. See
            src/lib/theme.ts for why this is an inline string rather than
            a component effect. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-myth-canvas text-myth-ink">
        <ErrorHandlerInit />
        <CommandPaletteProvider>
          <main className="container mx-auto px-4 py-8">
            {children}
          </main>
        </CommandPaletteProvider>
      </body>
    </html>
  )
}
