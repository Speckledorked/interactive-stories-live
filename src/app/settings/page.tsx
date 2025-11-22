// src/app/settings/page.tsx
// User settings page with tabs for different settings categories

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authenticatedFetch, isAuthenticated, getUser } from '@/lib/clientAuth'
import NotificationSettings from '@/components/settings/NotificationSettings'

type TabKey = 'notifications' | 'profile' | 'privacy'

export default function SettingsPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabKey>('notifications')
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    const currentUser = getUser()
    setUser(currentUser)
    setLoading(false)
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <div className="relative">
          <div className="spinner h-16 w-16"></div>
          <div className="absolute inset-0 h-16 w-16 rounded-full bg-primary-500/20 animate-ping"></div>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  const tabs = [
    { key: 'notifications' as TabKey, label: 'Notifications', icon: '🔔' },
    { key: 'profile' as TabKey, label: 'Profile', icon: '👤' },
    { key: 'privacy' as TabKey, label: 'Privacy', icon: '🔒' },
  ]

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      <div className="mb-12">
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition-colors group"
        >
          <svg className="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Campaigns
        </Link>

        <div className="relative">
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-primary-500/10 via-accent-500/5 to-transparent blur-3xl"></div>
          <h1 className="text-5xl font-bold tracking-tight bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent mb-3">
            Settings
          </h1>
          <p className="text-lg text-gray-400">
            Manage your account settings and preferences
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-dark-700/50 mb-8">
        <nav className="flex space-x-2">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative py-3 px-6 font-semibold text-sm transition-all duration-200 flex items-center gap-2 rounded-t-xl ${
                activeTab === tab.key
                  ? 'text-primary-400 bg-gradient-to-b from-primary-500/10 to-transparent'
                  : 'text-gray-400 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              <span className="text-lg">{tab.icon}</span>
              <span>{tab.label}</span>
              {activeTab === tab.key && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary-600 via-primary-500 to-primary-400 shadow-glow"></div>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {activeTab === 'notifications' && (
          <div className="card relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-primary-500/5 to-transparent blur-3xl"></div>
            <div className="relative">
              <div className="flex items-center gap-3 mb-6">
                <div className="text-3xl">🔔</div>
                <h2 className="text-2xl font-bold text-white">Notification Preferences</h2>
              </div>
              <NotificationSettings />
            </div>
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="card relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-accent-500/5 to-transparent blur-3xl"></div>
            <div className="relative">
              <div className="flex items-center gap-3 mb-6">
                <div className="text-3xl">👤</div>
                <h2 className="text-2xl font-bold text-white">Profile Settings</h2>
              </div>
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-2">Email</label>
                  <input
                    type="email"
                    value={user.email}
                    disabled
                    className="input-field w-full bg-dark-800/50 cursor-not-allowed opacity-75"
                  />
                  <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Email cannot be changed at this time
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-2">Display Name</label>
                  <input
                    type="text"
                    placeholder="Your display name (optional)"
                    className="input-field w-full"
                  />
                  <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    This is how other players will see you
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-2">Bio</label>
                  <textarea
                    placeholder="Tell others about yourself (optional)"
                    rows={4}
                    className="input-field w-full resize-none"
                  />
                </div>

                <div className="pt-4 border-t border-dark-700/50">
                  <button className="btn-primary" disabled>
                    Save Profile
                  </button>
                  <p className="text-xs text-gray-500 mt-3 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Profile editing coming soon!
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'privacy' && (
          <div className="card relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-primary-500/5 to-transparent blur-3xl"></div>
            <div className="relative">
              <div className="flex items-center gap-3 mb-6">
                <div className="text-3xl">🔒</div>
                <h2 className="text-2xl font-bold text-white">Privacy & Security</h2>
              </div>
              <div className="space-y-0">
                <div className="flex items-center justify-between py-4 border-b border-dark-700/50">
                  <div>
                    <h3 className="text-white font-semibold mb-1">Show Online Status</h3>
                    <p className="text-sm text-gray-400">Let other players see when you're online</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" defaultChecked />
                    <div className="w-11 h-6 bg-dark-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-900/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-primary-600 peer-checked:to-primary-500 shadow-inner"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between py-4 border-b border-dark-700/50">
                  <div>
                    <h3 className="text-white font-semibold mb-1">Allow Direct Messages</h3>
                    <p className="text-sm text-gray-400">Allow other players to send you whispers</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" defaultChecked />
                    <div className="w-11 h-6 bg-dark-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-900/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-primary-600 peer-checked:to-primary-500 shadow-inner"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between py-4 border-b border-dark-700/50">
                  <div>
                    <h3 className="text-white font-semibold mb-1">Public Profile</h3>
                    <p className="text-sm text-gray-400">Make your profile visible to other players</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" defaultChecked />
                    <div className="w-11 h-6 bg-dark-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-900/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-primary-600 peer-checked:to-primary-500 shadow-inner"></div>
                  </label>
                </div>
              </div>

              <div className="pt-6 border-t border-dark-700/50 mt-6">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                  <h3 className="text-white font-semibold">Change Password</h3>
                </div>
                <p className="text-sm text-gray-400 mb-4">Update your password to keep your account secure</p>
                <button className="btn-secondary" disabled>
                  Change Password
                </button>
                <p className="text-xs text-gray-500 mt-3 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Password management coming soon!
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Danger Zone - Separate Card */}
        {activeTab === 'privacy' && (
          <div className="card relative overflow-hidden bg-gradient-to-br from-danger-900/20 to-danger-800/10 border-danger-700/30">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-danger-500/10 to-transparent blur-3xl"></div>
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="text-3xl">⚠️</div>
                <h3 className="text-xl font-bold text-danger-400">Danger Zone</h3>
              </div>
              <p className="text-sm text-gray-300 mb-6 leading-relaxed">
                Permanently delete your account and all associated data. This action cannot be undone.
              </p>
              <button className="btn-danger" disabled>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete Account
              </button>
              <p className="text-xs text-gray-500 mt-3 flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Account deletion coming soon!
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
