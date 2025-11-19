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
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
        <p className="mt-4 text-gray-400">Loading...</p>
      </div>
    </div>
  )
}
