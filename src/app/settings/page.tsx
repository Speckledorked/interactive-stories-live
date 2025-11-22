// src/app/settings/page.tsx
// User settings page with tabs for different settings categories

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
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
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
        <p className="text-gray-400">Manage your account settings and preferences</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-700 mb-6">
        <nav className="flex space-x-8">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2 ${
                activeTab === tab.key
                  ? 'border-primary-500 text-primary-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {activeTab === 'notifications' && (
          <div className="card">
            <h2 className="text-xl font-bold text-white mb-4">Notification Preferences</h2>
            <NotificationSettings />
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="card">
            <h2 className="text-xl font-bold text-white mb-4">Profile Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Email</label>
                <input
                  type="email"
                  value={user.email}
                  disabled
                  className="input-field w-full bg-gray-800 cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">Email cannot be changed at this time</p>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Display Name</label>
                <input
                  type="text"
                  placeholder="Your display name (optional)"
                  className="input-field w-full"
                />
                <p className="text-xs text-gray-500 mt-1">This is how other players will see you</p>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Bio</label>
                <textarea
                  placeholder="Tell others about yourself (optional)"
                  rows={4}
                  className="input-field w-full"
                />
              </div>

              <div className="pt-4">
                <button className="btn-primary" disabled>
                  Save Profile
                </button>
                <p className="text-xs text-gray-500 mt-2">Profile editing coming soon!</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'privacy' && (
          <div className="card">
            <h2 className="text-xl font-bold text-white mb-4">Privacy & Security</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3 border-b border-gray-700">
                <div>
                  <h3 className="text-white font-medium">Show Online Status</h3>
                  <p className="text-sm text-gray-500">Let other players see when you're online</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" defaultChecked />
                  <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                </label>
              </div>

              <div className="flex items-center justify-between py-3 border-b border-gray-700">
                <div>
                  <h3 className="text-white font-medium">Allow Direct Messages</h3>
                  <p className="text-sm text-gray-500">Allow other players to send you whispers</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" defaultChecked />
                  <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                </label>
              </div>

              <div className="flex items-center justify-between py-3 border-b border-gray-700">
                <div>
                  <h3 className="text-white font-medium">Public Profile</h3>
                  <p className="text-sm text-gray-500">Make your profile visible to other players</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" defaultChecked />
                  <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                </label>
              </div>

              <div className="pt-4">
                <h3 className="text-white font-medium mb-2">Change Password</h3>
                <p className="text-sm text-gray-500 mb-4">Update your password to keep your account secure</p>
                <button className="btn-secondary" disabled>
                  Change Password
                </button>
                <p className="text-xs text-gray-500 mt-2">Password management coming soon!</p>
              </div>

              <div className="pt-4 border-t border-gray-700">
                <h3 className="text-white font-medium mb-2 text-red-400">Danger Zone</h3>
                <p className="text-sm text-gray-500 mb-4">Permanently delete your account and all associated data</p>
                <button className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition-colors" disabled>
                  Delete Account
                </button>
                <p className="text-xs text-gray-500 mt-2">Account deletion coming soon!</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
