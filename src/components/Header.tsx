// src/components/Header.tsx
// Navigation header with logout

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { getUser, logout, isAuthenticated } from '@/lib/clientAuth'
import { authenticatedFetch } from '@/lib/clientAuth'
import NotificationPanel from '@/components/notifications/NotificationPanel'
import KeyboardShortcutsModal from '@/components/KeyboardShortcutsModal'
import BalanceDisplay from '@/components/BalanceDisplay'

export default function Header() {
  const [user, setUser] = useState<{ email: string; id: string } | null>(null)
  const [isAuth, setIsAuth] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [showNotifications, setShowNotifications] = useState(false)
  const [showHelpMenu, setShowHelpMenu] = useState(false)
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    const authenticated = isAuthenticated()
    setIsAuth(authenticated)
    const currentUser = getUser()
    setUser(currentUser)

    // Load unread notification count if authenticated
    if (authenticated && currentUser) {
      loadUnreadCount(currentUser.id)
    }
  }, [pathname])

  const loadUnreadCount = async (userId: string) => {
    try {
      const response = await authenticatedFetch(`/api/notifications?userId=${userId}&unread=true`)
      if (response.ok) {
        const data = await response.json()
        setUnreadCount(data.notifications?.length || 0)
      }
    } catch (err) {
      console.error('Failed to load notification count:', err)
    }
  }

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  // Don't show header on login/signup pages
  if (pathname === '/login' || pathname === '/signup') {
    return null
  }

  return (
    <header className="bg-gradient-to-r from-dark-900/95 via-dark-850/95 to-dark-900/95 backdrop-blur-md border-b border-dark-700/50 sticky top-0 z-40 shadow-lg">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-3 group">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-600 to-primary-500 rounded-xl flex items-center justify-center shadow-lg shadow-primary-500/25 group-hover:shadow-primary-500/40 transition-all duration-200 group-hover:scale-105">
              <span className="text-white font-bold text-xl">🎲</span>
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">AI GM</span>
          </Link>

          {/* Navigation */}
          {isAuth && user && (
            <nav className="flex items-center space-x-2">
              <Link
                href="/campaigns"
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  pathname === '/campaigns'
                    ? 'bg-primary-500/10 text-primary-400 shadow-inner'
                    : 'text-gray-300 hover:text-white hover:bg-white/5'
                }`}
              >
                Campaigns
              </Link>

              {/* Notifications bell */}
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative p-2.5 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-all duration-200"
                title="Notifications"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-gradient-to-r from-danger-600 to-danger-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center shadow-lg shadow-danger-500/30 animate-pulse">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {/* Balance Display */}
              <BalanceDisplay userId={user.id} />

              {/* Help menu */}
              <div className="relative">
                <button
                  onClick={() => setShowHelpMenu(!showHelpMenu)}
                  className="p-2.5 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-all duration-200"
                  title="Help & Tutorial"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </button>

                {showHelpMenu && (
                  <div className="absolute right-0 mt-2 w-64 bg-gradient-to-br from-dark-850 to-dark-900 border border-dark-700/50 rounded-2xl shadow-elevated overflow-hidden animate-scale-in">
                    <div className="py-2">
                      <Link
                        href="/tutorial"
                        className="flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-all duration-200"
                        onClick={() => setShowHelpMenu(false)}
                      >
                        <span className="text-lg">📚</span>
                        <span className="font-medium">Tutorial & Onboarding</span>
                      </Link>
                      <button
                        onClick={() => {
                          setShowKeyboardShortcuts(true)
                          setShowHelpMenu(false)
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-all duration-200"
                      >
                        <span className="text-lg">⌨️</span>
                        <span className="font-medium">Keyboard Shortcuts</span>
                      </button>
                      <Link
                        href="/help"
                        className="flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-all duration-200"
                        onClick={() => setShowHelpMenu(false)}
                      >
                        <span className="text-lg">❓</span>
                        <span className="font-medium">Help & Documentation</span>
                      </Link>
                    </div>
                  </div>
                )}
              </div>

              {/* Settings link */}
              <Link
                href="/settings"
                className={`p-2.5 rounded-lg transition-all duration-200 ${
                  pathname === '/settings'
                    ? 'bg-primary-500/10 text-primary-400'
                    : 'text-gray-300 hover:text-white hover:bg-white/5'
                }`}
                title="Settings"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </Link>

              {/* Divider */}
              <div className="h-6 w-px bg-dark-700/50 mx-2"></div>

              {/* User menu */}
              <div className="flex items-center gap-3">
                <div className="px-3 py-1.5 bg-dark-800/50 rounded-lg border border-dark-700/50">
                  <span className="text-sm text-gray-400 font-medium">{user?.email}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-all duration-200"
                >
                  Logout
                </button>
              </div>

              {/* Notification Panel */}
              <NotificationPanel
                userId={user.id}
                campaignId=""
                isOpen={showNotifications}
                onClose={() => {
                  setShowNotifications(false)
                  loadUnreadCount(user.id)
                }}
              />
            </nav>
          )}
        </div>
      </div>

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={showKeyboardShortcuts}
        onClose={() => setShowKeyboardShortcuts(false)}
      />
    </header>
  )
}
