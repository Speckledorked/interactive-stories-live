// src/app/settings/page.tsx
// User settings page with tabs for different settings categories

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authenticatedFetch, isAuthenticated, getUser } from '@/lib/clientAuth'
import NotificationSettings from '@/components/settings/NotificationSettings'
import BalanceDisplay from '@/components/BalanceDisplay'
import { Bell, User, Lock, X } from 'lucide-react'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { TavernSpinner } from '@/components/tavern/ui'

type TabKey = 'notifications' | 'profile' | 'privacy'

export default function SettingsPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabKey>('notifications')
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)

  // Profile editing state
  const [displayName, setDisplayName] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMessage, setProfileMessage] = useState('')

  // Password change state
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState('')

  // Delete account state
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [deleteMessage, setDeleteMessage] = useState('')

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    const currentUser = getUser()
    setUser(currentUser)
    setDisplayName(currentUser?.name || '')
    setLoading(false)
  }, [])

  // Handler: Save profile
  const handleSaveProfile = async () => {
    setSavingProfile(true)
    setProfileMessage('')

    try {
      const response = await authenticatedFetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: displayName })
      })

      const data = await response.json()

      if (response.ok) {
        setUser(data.user)
        // Update local storage
        const currentUser = getUser()
        if (currentUser) {
          localStorage.setItem('user', JSON.stringify({ ...currentUser, name: displayName }))
        }
        setProfileMessage('✓ Profile updated successfully!')
        setTimeout(() => setProfileMessage(''), 3000)
      } else {
        setProfileMessage(`✗ ${data.error || 'Failed to update profile'}`)
      }
    } catch (error) {
      console.error('Save profile error:', error)
      setProfileMessage('✗ An error occurred while saving')
    } finally {
      setSavingProfile(false)
    }
  }

  // Handler: Change password
  const handleChangePassword = async () => {
    setPasswordMessage('')

    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMessage('✗ All fields are required')
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage('✗ New passwords do not match')
      return
    }

    if (newPassword.length < 8) {
      setPasswordMessage('✗ Password must be at least 8 characters')
      return
    }

    setChangingPassword(true)

    try {
      const response = await authenticatedFetch('/api/user/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      })

      const data = await response.json()

      if (response.ok) {
        setPasswordMessage('✓ Password changed successfully!')
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setTimeout(() => {
          setShowPasswordModal(false)
          setPasswordMessage('')
        }, 2000)
      } else {
        setPasswordMessage(`✗ ${data.error || 'Failed to change password'}`)
      }
    } catch (error) {
      console.error('Change password error:', error)
      setPasswordMessage('✗ An error occurred')
    } finally {
      setChangingPassword(false)
    }
  }

  // Handler: Delete account
  const handleDeleteAccount = async () => {
    setDeleteMessage('')

    if (deleteConfirmation !== 'DELETE MY ACCOUNT') {
      setDeleteMessage('✗ Please type "DELETE MY ACCOUNT" to confirm')
      return
    }

    setDeletingAccount(true)

    try {
      const response = await authenticatedFetch('/api/user', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: deleteConfirmation })
      })

      const data = await response.json()

      if (response.ok) {
        setDeleteMessage('✓ Account deleted. Redirecting...')
        // Clear auth and redirect to home
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        setTimeout(() => {
          router.push('/')
        }, 1500)
      } else {
        setDeleteMessage(`✗ ${data.error || 'Failed to delete account'}`)
      }
    } catch (error) {
      console.error('Delete account error:', error)
      setDeleteMessage('✗ An error occurred')
    } finally {
      setDeletingAccount(false)
    }
  }

  if (loading) {
    return (
      <TavernPage>
        <TavernHeader backHref="/campaigns" title="Settings" />
        <main className="max-w-4xl mx-auto px-4 pt-28 pb-16">
          <TavernSpinner className="h-16 w-16" />
        </main>
      </TavernPage>
    )
  }

  if (!user) {
    return null
  }

  const tabs = [
    { key: 'notifications' as TabKey, label: 'Notifications', icon: Bell },
    { key: 'profile' as TabKey, label: 'Profile', icon: User },
    { key: 'privacy' as TabKey, label: 'Privacy', icon: Lock },
  ]

  return (
    <TavernPage>
      <TavernHeader
        backHref="/campaigns"
        title="Settings"
        subrow={
          <nav className="max-w-4xl mx-auto px-4 flex items-center gap-1 text-sm border-t border-ember-900/20 pt-2 pb-0">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-2.5 py-2 border-b-2 transition-colors ${
                  activeTab === tab.key ? 'border-ember-400 text-ember-200' : 'border-transparent text-ember-300/40 hover:text-ember-300/70'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        }
      />

      <main className="max-w-4xl mx-auto px-4 pt-28 pb-28 space-y-6">
        <p className="text-ember-300/50 text-sm">Manage your account settings and preferences</p>

      {/* Tab Content */}
      <div className="space-y-6">
        {activeTab === 'notifications' && (
          <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-ember-900/15 to-transparent blur-3xl"></div>
            <div className="relative">
              <div className="flex items-center gap-3 mb-6">
                <div className="text-3xl">🔔</div>
                <h2 className="text-2xl font-bold text-ember-100">Notification Preferences</h2>
              </div>
              <NotificationSettings />
            </div>
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-wine-800/10 to-transparent blur-3xl"></div>
            <div className="relative">
              <div className="flex items-center gap-3 mb-6">
                <div className="text-3xl">👤</div>
                <h2 className="text-2xl font-bold text-ember-100">Profile Settings</h2>
              </div>
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-ember-200/80 mb-2">Email</label>
                  <input
                    type="email"
                    value={user.email}
                    disabled
                    className="px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60 w-full bg-black/20 cursor-not-allowed opacity-75"
                  />
                  <p className="text-xs text-ember-400/50 mt-2 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Email cannot be changed at this time
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-ember-200/80 mb-2">Display Name</label>
                  <input
                    type="text"
                    placeholder="Your display name (optional)"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={100}
                    className="px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60 w-full"
                  />
                  <p className="text-xs text-ember-400/50 mt-2 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    This is how other players will see you
                  </p>
                </div>

                <div className="pt-4 border-t border-ember-900/30">
                  <button
                    className="px-4 py-2.5 rounded-lg bg-gradient-to-b from-wine-500 to-wine-700 hover:from-wine-400 hover:to-wine-600 text-ember-100 font-medium border border-ember-900/50 shadow-lg shadow-black/40 transition-all text-center"
                    onClick={handleSaveProfile}
                    disabled={savingProfile}
                  >
                    {savingProfile ? (
                      <div className="flex items-center gap-2">
                        <div className="spinner h-4 w-4"></div>
                        Saving...
                      </div>
                    ) : (
                      'Save Profile'
                    )}
                  </button>
                  {profileMessage && (
                    <p className={`text-sm mt-3 flex items-center gap-1 ${
                      profileMessage.startsWith('✓') ? 'text-success-400' : 'text-wine-400'
                    }`}>
                      {profileMessage}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Balance - Separate Card */}
        {activeTab === 'profile' && (
          <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="text-3xl">💰</div>
              <h2 className="text-2xl font-bold text-ember-100">Balance & Billing</h2>
            </div>
            <p className="text-sm text-ember-300/60 mb-4">
              Your current balance covers AI scene resolution costs. Click your balance below to add funds.
            </p>
            <BalanceDisplay userId={user.id} />
          </div>
        )}

        {activeTab === 'privacy' && (
          <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-ember-900/15 to-transparent blur-3xl"></div>
            <div className="relative">
              <div className="flex items-center gap-3 mb-6">
                <div className="text-3xl">🔒</div>
                <h2 className="text-2xl font-bold text-ember-100">Privacy & Security</h2>
              </div>
              <div className="space-y-0">
                <div className="flex items-center justify-between py-4 border-b border-ember-900/30">
                  <div>
                    <h3 className="text-ember-100 font-semibold mb-1">Show Online Status</h3>
                    <p className="text-sm text-ember-300/60">Let other players see when you're online</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" defaultChecked />
                    <div className="w-11 h-6 bg-black/40 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-ember-900/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-ember-900/40 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-ember-600 peer-checked:to-ember-500 shadow-inner"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between py-4 border-b border-ember-900/30">
                  <div>
                    <h3 className="text-ember-100 font-semibold mb-1">Allow Direct Messages</h3>
                    <p className="text-sm text-ember-300/60">Allow other players to send you whispers</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" defaultChecked />
                    <div className="w-11 h-6 bg-black/40 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-ember-900/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-ember-900/40 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-ember-600 peer-checked:to-ember-500 shadow-inner"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between py-4 border-b border-ember-900/30">
                  <div>
                    <h3 className="text-ember-100 font-semibold mb-1">Public Profile</h3>
                    <p className="text-sm text-ember-300/60">Make your profile visible to other players</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" defaultChecked />
                    <div className="w-11 h-6 bg-black/40 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-ember-900/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-ember-900/40 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-ember-600 peer-checked:to-ember-500 shadow-inner"></div>
                  </label>
                </div>
              </div>

              <div className="pt-6 border-t border-ember-900/30 mt-6">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-ember-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                  <h3 className="text-ember-100 font-semibold">Change Password</h3>
                </div>
                <p className="text-sm text-ember-300/60 mb-4">Update your password to keep your account secure</p>
                <button className="px-4 py-2.5 rounded-lg bg-black/30 hover:bg-black/40 border border-ember-900/40 text-ember-300 font-medium transition-colors text-center" onClick={() => setShowPasswordModal(true)}>
                  Change Password
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Danger Zone - Separate Card */}
        {activeTab === 'privacy' && (
          <div className="rounded-xl bg-gradient-to-br from-wine-800/20 to-wine-800/10 border border-wine-700/40 shadow-lg shadow-black/30 p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-wine-700/10 to-transparent blur-3xl"></div>
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="text-3xl">⚠️</div>
                <h3 className="text-xl font-bold text-wine-400">Danger Zone</h3>
              </div>
              <p className="text-sm text-ember-200/80 mb-6 leading-relaxed">
                Permanently delete your account and all associated data. This action cannot be undone.
              </p>
              <button className="px-4 py-2.5 rounded-lg bg-wine-700 hover:bg-wine-600 text-ember-100 font-medium transition-colors text-center flex items-center justify-center gap-2" onClick={() => setShowDeleteModal(true)}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete Account
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 overflow-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-6 max-w-md w-full relative animate-fade-in">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-ember-100">Change Password</h3>
              <button
                onClick={() => {
                  setShowPasswordModal(false)
                  setPasswordMessage('')
                  setCurrentPassword('')
                  setNewPassword('')
                  setConfirmPassword('')
                }}
                className="text-ember-300/60 hover:text-ember-100 transition-colors text-xl"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-ember-200/80 mb-2">Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60 w-full"
                  placeholder="Enter current password"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-ember-200/80 mb-2">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60 w-full"
                  placeholder="Enter new password (min 8 characters)"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-ember-200/80 mb-2">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60 w-full"
                  placeholder="Confirm new password"
                />
              </div>

              {passwordMessage && (
                <p className={`text-sm flex items-center gap-1 ${
                  passwordMessage.startsWith('✓') ? 'text-success-400' : 'text-wine-400'
                }`}>
                  {passwordMessage}
                </p>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleChangePassword}
                  disabled={changingPassword}
                  className="px-4 py-2.5 rounded-lg bg-gradient-to-b from-wine-500 to-wine-700 hover:from-wine-400 hover:to-wine-600 text-ember-100 font-medium border border-ember-900/50 shadow-lg shadow-black/40 transition-all text-center flex-1"
                >
                  {changingPassword ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="spinner h-4 w-4"></div>
                      Changing...
                    </div>
                  ) : (
                    'Change Password'
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowPasswordModal(false)
                    setPasswordMessage('')
                    setCurrentPassword('')
                    setNewPassword('')
                    setConfirmPassword('')
                  }}
                  className="px-4 py-2.5 rounded-lg bg-black/30 hover:bg-black/40 border border-ember-900/40 text-ember-300 font-medium transition-colors text-center"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 overflow-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="rounded-xl bg-gradient-to-br from-wine-800/20 to-tavern-900 border border-wine-700/40 shadow-lg shadow-black/30 p-6 max-w-md w-full relative animate-fade-in">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <span className="text-2xl">⚠️</span>
                <h3 className="text-xl font-bold text-wine-400">Delete Account</h3>
              </div>
              <button
                onClick={() => {
                  setShowDeleteModal(false)
                  setDeleteMessage('')
                  setDeleteConfirmation('')
                }}
                className="text-ember-300/60 hover:text-ember-100 transition-colors text-xl"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div className="bg-wine-800/20 border border-wine-700/40 rounded-lg p-4">
                <p className="text-sm text-ember-200/80 leading-relaxed">
                  This action is <strong className="text-wine-400">permanent</strong> and cannot be undone. All your:
                </p>
                <ul className="mt-3 space-y-1 text-sm text-ember-300/60">
                  <li>• Characters and their progress</li>
                  <li>• Campaign memberships</li>
                  <li>• Game history and actions</li>
                  <li>• Personal settings and preferences</li>
                </ul>
                <p className="mt-3 text-sm text-ember-200/80">
                  will be <strong className="text-wine-400">permanently deleted</strong>.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-ember-200/80 mb-2">
                  Type <span className="text-wine-400 font-mono">DELETE MY ACCOUNT</span> to confirm:
                </label>
                <input
                  type="text"
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                  className="px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60 w-full font-mono"
                  placeholder="DELETE MY ACCOUNT"
                />
              </div>

              {deleteMessage && (
                <p className={`text-sm flex items-center gap-1 ${
                  deleteMessage.startsWith('✓') ? 'text-success-400' : 'text-wine-400'
                }`}>
                  {deleteMessage}
                </p>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleDeleteAccount}
                  disabled={deletingAccount || deleteConfirmation !== 'DELETE MY ACCOUNT'}
                  className="px-4 py-2.5 rounded-lg bg-wine-700 hover:bg-wine-600 text-ember-100 font-medium transition-colors text-center flex items-center justify-center gap-2 flex-1"
                >
                  {deletingAccount ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="spinner h-4 w-4"></div>
                      Deleting...
                    </div>
                  ) : (
                    'Delete My Account'
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowDeleteModal(false)
                    setDeleteMessage('')
                    setDeleteConfirmation('')
                  }}
                  className="px-4 py-2.5 rounded-lg bg-black/30 hover:bg-black/40 border border-ember-900/40 text-ember-300 font-medium transition-colors text-center"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </main>

      <TavernNav active="settings" />
    </TavernPage>
  )
}
