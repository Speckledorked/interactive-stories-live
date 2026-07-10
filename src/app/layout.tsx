// src/app/layout.tsx
// Root layout - wraps all pages

import type { Metadata, Viewport } from 'next'
import './globals.css'
import { CommandPaletteProvider } from '@/contexts/CommandPaletteContext'
import { ErrorHandlerInit } from './ErrorHandlerInit'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  title: 'MythOS - Automated Game Master',
  description: 'The world remembers. Play tabletop RPGs with an AI Game Master.',
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
  themeColor: '#0c0705',
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-tavern-950">
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
