// src/app/layout.tsx
// Root layout - wraps all pages

import type { Metadata } from 'next'
import './globals.css'
import Header from '@/components/Header'
import { CommandPaletteProvider } from '@/contexts/CommandPaletteContext'
import { ErrorHandlerInit } from './ErrorHandlerInit'

export const metadata: Metadata = {
  title: 'AI GM - Automated Game Master',
  description: 'Play tabletop RPGs with an AI Game Master',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-900">
        <ErrorHandlerInit />
        <CommandPaletteProvider>
          <Header />
          <main className="container mx-auto px-4 py-8">
            {children}
          </main>
        </CommandPaletteProvider>
      </body>
    </html>
  )
}
