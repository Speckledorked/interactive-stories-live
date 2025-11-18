// src/components/Header.tsx
// Navigation header with logout

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { getUser, logout, isAuthenticated } from '@/lib/clientAuth'

export default function Header() {
  const [user, setUser] = useState<{ email: string } | null>(null)
  const [isAuth, setIsAuth] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    setIsAuth(isAuthenticated())
    setUser(getUser())
  }, [pathname])

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  // Don't show header on login/signup pages
  if (pathname === '/login' || pathname === '/signup') {
    return null
  }

  return (
    <header className="bg-gray-800 border-b border-gray-700">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xl">🎲</span>
            </div>
            <span className="text-xl font-bold text-white">AI GM</span>
          </Link>

          {/* Navigation */}
          {isAuth && (
            <nav className="flex items-center space-x-6">
              <Link
                href="/campaigns"
                className={`text-sm font-medium transition-colors ${
                  pathname === '/campaigns'
                    ? 'text-primary-400'
                    : 'text-gray-300 hover:text-white'
                }`}
              >
                Campaigns
              </Link>

              {/* User menu */}
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-400">{user?.email}</span>
                <button
                  onClick={handleLogout}
                  className="text-sm font-medium text-gray-300 hover:text-white transition-colors"
                >
                  Logout
                </button>
              </div>
            </nav>
          )}
        </div>
      </div>
    </header>
  )
}
