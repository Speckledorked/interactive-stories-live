// src/app/layout.tsx
// Root layout - wraps all pages

import type { Metadata, Viewport } from 'next'
import './globals.css'
import { CommandPaletteProvider } from '@/contexts/CommandPaletteContext'
import { ErrorHandlerInit } from './ErrorHandlerInit'

export const metadata: Metadata = {
  title: 'MythOS - Automated Game Master',
  description: 'Play tabletop RPGs with an AI Game Master',
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
