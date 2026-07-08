// test deploy
// src/app/page.tsx
// Home page - redirects based on auth status

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isAuthenticated } from '@/lib/clientAuth'

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
    <div className="-mx-4 -my-8 min-h-screen flex items-center justify-center bg-tavern-950">
      <div className="text-center">
        <div className="spinner h-10 w-10 mx-auto" />
        <p className="mt-4 text-ember-300/50 text-sm tracking-wide">Loading…</p>
      </div>
    </div>
  )
}
