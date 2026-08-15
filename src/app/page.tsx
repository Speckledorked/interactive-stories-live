// test deploy
// src/app/page.tsx
// Home page - redirects based on auth status

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isAuthenticated } from '@/lib/clientAuth'
import { Spinner } from '@/components/ui/spinner'

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    // Redirect based on auth status
    if (isAuthenticated()) {
      router.push('/campaigns')
    } else {
      router.push('/login')
    }
  }, [router])

  return (
    <div className="-mx-4 -my-8 min-h-screen flex items-center justify-center bg-myth-canvas">
      <div className="text-center">
        <Spinner className="mx-auto h-10 w-10" />
        <p className="mt-4 text-myth-ink-faint text-sm tracking-wide">Loading…</p>
      </div>
    </div>
  )
}
