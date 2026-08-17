// src/app/settings/page.tsx
// User settings page with tabs for different settings categories

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authenticatedFetch, isAuthenticated, getUser, getLastCampaignId, updateStoredUser } from '@/lib/clientAuth'
import NotificationSettings from '@/components/settings/NotificationSettings'
import { ThemeSetting } from '@/components/settings/ThemeSetting'
import BalanceDisplay from '@/components/BalanceDisplay'
import { AlertTriangle, Bell, Coins, Lock, User, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { SubNavTabs } from '@/components/ui/SubNavTabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { UI_ICONS } from '@/lib/ui/icons'
import { HEADER_OFFSET_SUBROW } from '@/components/tavern/headerOffset'

type TabKey = 'notifications' | 'profile' | 'privacy'

// Success/failure used to be encoded in the message string itself — a
// '✓ '/'✗ ' prefix that the render site then read back with
// `.startsWith('✓')` to pick a color. That made a glyph load-bearing:
// changing the icon would have silently broken the coloring. The state
// carries the outcome explicitly now, and the icon is just an icon.
type StatusMessage = { ok: boolean; text: string } | null

export default function SettingsPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabKey>('notifications')
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)

  // Profile editing state
  const [displayName, setDisplayName] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMessage, setProfileMessage] = useState<StatusMessage>(null)

  // Password change state
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<StatusMessage>(null)

  // Delete account state
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  // #415: session revocation had a backend, a route and a test, and ZERO
  // client callers — so the mitigation cited for the 30-day JWT lifetime
  // was one a user could not actually invoke. Backend-first delivery with
  // nothing tracking the client half: tsc is clean and the route has a
  // test, so every automated signal reported the feature as done.
  const [revokingSessions, setRevokingSessions] = useState(false)
  const [revokeMessage, setRevokeMessage] = useState<StatusMessage>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [deleteMessage, setDeleteMessage] = useState<StatusMessage>(null)
  const [lastCampaignId, setLastCampaignIdState] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    const currentUser = getUser()
    setUser(currentUser)
    setDisplayName(currentUser?.name || '')
    setLastCampaignIdState(getLastCampaignId())
    setLoading(false)
  }, [])

  // Handler: Save profile
  const handleSaveProfile = async () => {
    setSavingProfile(true)
    setProfileMessage(null)

    try {
      const response = await authenticatedFetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: displayName })
      })

      const data = await response.json()

      if (response.ok) {
        setUser(data.user)
        updateStoredUser({ name: displayName })
        setProfileMessage({ ok: true, text: 'Profile updated successfully!' })
        setTimeout(() => setProfileMessage(null), 3000)
      } else {
        setProfileMessage({ ok: false, text: `${data.error || 'Failed to update profile'}` })
      }
    } catch (error) {
      console.error('Save profile error:', error)
      setProfileMessage({ ok: false, text: 'An error occurred while saving' })
    } finally {
      setSavingProfile(false)
    }
  }

  // Handler: Change password
  const handleRevokeSessions = async () => {
    setRevokingSessions(true)
    setRevokeMessage(null)
    try {
      const response = await authenticatedFetch('/api/auth/logout-all', { method: 'POST' })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setRevokeMessage({ ok: false, text: data.error || 'Could not sign out everywhere. Please try again.' })
        return
      }
      // The request's own token is now invalid too — that is the point.
      // Send them to sign in again rather than leaving the page in a state
      // where every subsequent call 401s.
      localStorage.clear()
      router.push('/login?signedOutEverywhere=1')
    } catch {
      setRevokeMessage({ ok: false, text: 'Could not sign out everywhere. Please try again.' })
    } finally {
      setRevokingSessions(false)
    }
  }

  const handleChangePassword = async () => {
    setPasswordMessage(null)

    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMessage({ ok: false, text: 'All fields are required' })
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ ok: false, text: 'New passwords do not match' })
      return
    }

    if (newPassword.length < 8) {
      setPasswordMessage({ ok: false, text: 'Password must be at least 8 characters' })
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
        setPasswordMessage({ ok: true, text: 'Password changed successfully!' })
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setTimeout(() => {
          setShowPasswordModal(false)
          setPasswordMessage(null)
        }, 2000)
      } else {
        setPasswordMessage({ ok: false, text: `${data.error || 'Failed to change password'}` })
      }
    } catch (error) {
      console.error('Change password error:', error)
      setPasswordMessage({ ok: false, text: 'An error occurred' })
    } finally {
      setChangingPassword(false)
    }
  }

  // Handler: Delete account
  const handleDeleteAccount = async () => {
    setDeleteMessage(null)

    if (deleteConfirmation !== 'DELETE MY ACCOUNT') {
      setDeleteMessage({ ok: false, text: 'Please type "DELETE MY ACCOUNT" to confirm' })
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
        setDeleteMessage({ ok: true, text: 'Account deleted. Redirecting...' })
        // Clear auth and redirect to home
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        setTimeout(() => {
          router.push('/')
        }, 1500)
      } else {
        setDeleteMessage({ ok: false, text: `${data.error || 'Failed to delete account'}` })
      }
    } catch (error) {
      console.error('Delete account error:', error)
      setDeleteMessage({ ok: false, text: 'An error occurred' })
    } finally {
      setDeletingAccount(false)
    }
  }

  if (loading) {
    return (
      <TavernPage>
        <TavernHeader backHref="/campaigns" title="Settings" />
        <main className={`max-w-4xl mx-auto px-4 ${HEADER_OFFSET_SUBROW} pb-16`}>
          <div className="flex justify-center py-16">
            <div className="h-16 w-16 animate-spin rounded-full border-b-2 border-myth-accent" />
          </div>
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
          <nav className="max-w-4xl mx-auto px-4 flex items-center gap-2 text-sm border-t border-myth-border pt-2 pb-0">
            <SubNavTabs tabs={tabs} activeKey={activeTab} onSelect={(key) => setActiveTab(key as TabKey)} />
          </nav>
        }
      />

      <main className={`max-w-4xl mx-auto px-4 ${HEADER_OFFSET_SUBROW} pb-28 space-y-6`}>
        <p className="text-sm text-myth-ink-faint">Manage your account settings and preferences</p>

      {/* Tab Content */}
      <div className="space-y-6">
        {activeTab === 'notifications' && (
          <div className="rounded-lg border border-myth-border bg-myth-surface p-6">
            <div className="flex items-center gap-3 mb-6">
              <Bell className="h-7 w-7 text-myth-ink-muted" />
              <h2 className="text-2xl font-bold text-myth-ink">Notification Preferences</h2>
            </div>
            <NotificationSettings />
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="rounded-lg border border-myth-border bg-myth-surface p-6">
            <div className="flex items-center gap-3 mb-6">
              <User className="h-7 w-7 text-myth-ink-muted" />
              <h2 className="text-2xl font-bold text-myth-ink">Profile Settings</h2>
            </div>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-myth-ink-muted mb-2">Email</label>
                <Input
                  wrapperClassName="w-full"
                  type="email"
                  value={user.email}
                  disabled
                />
                <p className="text-xs text-myth-ink-faint mt-2 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Email cannot be changed at this time
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-myth-ink-muted mb-2">Display Name</label>
                <Input
                  wrapperClassName="w-full"
                  type="text"
                  placeholder="Your display name (optional)"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={100}
                />
                <p className="text-xs text-myth-ink-faint mt-2 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  This is how other players will see you
                </p>
              </div>

              <div className="pt-4 border-t border-myth-border">
                <ThemeSetting />
              </div>

              <div className="pt-4 border-t border-myth-border">
                <Button
                  variant="primary"
                  onClick={handleSaveProfile}
                  disabled={savingProfile}
                >
                  {savingProfile ? (
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-myth-accent-ink" />
                      Saving...
                    </div>
                  ) : (
                    'Save Profile'
                  )}
                </Button>
                {profileMessage && (
                  <p className={`mt-3 flex items-center gap-1.5 text-sm ${
                    profileMessage.ok ? 'text-myth-good' : 'text-myth-danger'
                  }`}>
                    {profileMessage.ok ? <UI_ICONS.success className="h-4 w-4" /> : <UI_ICONS.failure className="h-4 w-4" />}
                    {profileMessage.text}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Balance - Separate Card */}
        {activeTab === 'profile' && (
          <div className="rounded-lg border border-myth-border bg-myth-surface p-6">
            <div className="flex items-center gap-3 mb-4">
              <Coins className="h-7 w-7 text-myth-ink-muted" />
              <h2 className="text-2xl font-bold text-myth-ink">Balance & Billing</h2>
            </div>
            <p className="text-sm text-myth-ink-muted mb-4">
              Your current balance covers AI scene resolution costs. Click your balance below to add funds.
            </p>
            <BalanceDisplay userId={user.id} />
          </div>
        )}

        {activeTab === 'privacy' && (
          <div className="rounded-lg border border-myth-border bg-myth-surface p-6">
            <div className="flex items-center gap-3 mb-6">
              <Lock className="h-7 w-7 text-myth-ink-muted" />
              <h2 className="text-2xl font-bold text-myth-ink">Privacy & Security</h2>
            </div>
            <div className="space-y-0">
              <div className="flex items-center justify-between py-4 border-b border-myth-border">
                <div>
                  <h3 className="text-myth-ink font-semibold mb-1">Show Online Status</h3>
                  <p className="text-sm text-myth-ink-muted">Let other players see when you&apos;re online</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <Checkbox className="sr-only peer" defaultChecked />
                  <div className="w-11 h-6 bg-myth-surface-sunken peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-myth-accent/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-myth-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-myth-accent"></div>
                </label>
              </div>

              <div className="flex items-center justify-between py-4 border-b border-myth-border">
                <div>
                  <h3 className="text-myth-ink font-semibold mb-1">Allow Direct Messages</h3>
                  <p className="text-sm text-myth-ink-muted">Allow other players to send you whispers</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <Checkbox className="sr-only peer" defaultChecked />
                  <div className="w-11 h-6 bg-myth-surface-sunken peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-myth-accent/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-myth-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-myth-accent"></div>
                </label>
              </div>

              <div className="flex items-center justify-between py-4 border-b border-myth-border">
                <div>
                  <h3 className="text-myth-ink font-semibold mb-1">Public Profile</h3>
                  <p className="text-sm text-myth-ink-muted">Make your profile visible to other players</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <Checkbox className="sr-only peer" defaultChecked />
                  <div className="w-11 h-6 bg-myth-surface-sunken peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-myth-accent/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-myth-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-myth-accent"></div>
                </label>
              </div>
            </div>

            <div className="pt-6 border-t border-myth-border mt-6">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-5 h-5 text-myth-ink-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                <h3 className="text-myth-ink font-semibold">Change Password</h3>
              </div>
              <p className="text-sm text-myth-ink-muted mb-4">Update your password to keep your account secure</p>
              <Button variant="secondary" onClick={() => setShowPasswordModal(true)}>
                Change Password
              </Button>
            </div>
          </div>
        )}

        {/* #415: "Sign out everywhere" — the user-facing half of session
            revocation. Tokens are stateless JWTs with a 30-day life, so
            this is the only answer to "I think my token leaked" and to
            "does changing my password end sessions someone else already
            has?" (it doesn't, on its own). Sits above the Danger Zone
            rather than inside it: this is a recovery action, not a
            destructive one. */}
        {activeTab === 'privacy' && (
          <div className="mb-6 rounded-lg border border-myth-border bg-myth-surface-raised p-6">
            <h3 className="text-xl font-bold text-myth-ink mb-2">Sign out everywhere</h3>
            <p className="text-sm text-myth-ink-muted mb-6 leading-relaxed">
              Ends every signed-in session on every device, including this one. Use this if you
              think someone else has access to your account — changing your password alone does
              not end sessions that are already signed in.
            </p>
            {revokeMessage && (
              <p
                className={`mb-4 text-sm ${revokeMessage.ok ? 'text-myth-good' : 'text-myth-danger'}`}
                role="status"
              >
                {revokeMessage.text}
              </p>
            )}
            <Button variant="secondary" onClick={handleRevokeSessions} disabled={revokingSessions}>
              {revokingSessions ? 'Signing out…' : 'Sign out of all devices'}
            </Button>
          </div>
        )}

        {/* Danger Zone - Separate Card */}
        {activeTab === 'privacy' && (
          <div className="rounded-lg border border-myth-danger/30 bg-myth-danger/10 p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="h-7 w-7 text-myth-danger" />
              <h3 className="text-xl font-bold text-myth-danger">Danger Zone</h3>
            </div>
            <p className="text-sm text-myth-ink-muted mb-6 leading-relaxed">
              Permanently delete your account and all associated data. This action cannot be undone.
            </p>
            <Button variant="danger" onClick={() => setShowDeleteModal(true)}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete Account
            </Button>
          </div>
        )}
      </div>

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 overflow-auto bg-black/50 flex items-center justify-center p-4">
          <div className="rounded-lg border border-myth-border bg-myth-surface-raised p-6 max-w-md w-full shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.16)]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-myth-ink">Change Password</h3>
              <IconButton
                icon={X}
                label="Close change-password dialog"
                onClick={() => {
                  setShowPasswordModal(false)
                  setPasswordMessage(null)
                  setCurrentPassword('')
                  setNewPassword('')
                  setConfirmPassword('')
                }}
              />
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-myth-ink-muted mb-2">Current Password</label>
                <Input
                  wrapperClassName="w-full"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-myth-ink-muted mb-2">New Password</label>
                <Input
                  wrapperClassName="w-full"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password (min 8 characters)"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-myth-ink-muted mb-2">Confirm New Password</label>
                <Input
                  wrapperClassName="w-full"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                />
              </div>

              {passwordMessage && (
                <p className={`flex items-center gap-1.5 text-sm ${
                  passwordMessage.ok ? 'text-myth-good' : 'text-myth-danger'
                }`}>
                  {passwordMessage.ok ? <UI_ICONS.success className="h-4 w-4" /> : <UI_ICONS.failure className="h-4 w-4" />}
                  {passwordMessage.text}
                </p>
              )}

              <div className="flex gap-3 pt-4">
                <Button
                  variant="primary" fullWidth
                  onClick={handleChangePassword}
                  disabled={changingPassword}
                >
                  {changingPassword ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-myth-accent-ink" />
                      Changing...
                    </div>
                  ) : (
                    'Change Password'
                  )}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowPasswordModal(false)
                    setPasswordMessage(null)
                    setCurrentPassword('')
                    setNewPassword('')
                    setConfirmPassword('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 overflow-auto bg-black/50 flex items-center justify-center p-4">
          <div className="rounded-lg border border-myth-danger/30 bg-myth-surface-raised p-6 max-w-md w-full shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.16)]">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-6 w-6 flex-shrink-0 text-myth-danger" />
                <h3 className="text-xl font-bold text-myth-danger">Delete Account</h3>
              </div>
              <IconButton
                icon={X}
                label="Close delete-account dialog"
                onClick={() => {
                  setShowDeleteModal(false)
                  setDeleteMessage(null)
                  setDeleteConfirmation('')
                }}
              />
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-myth-danger/30 bg-myth-danger/10 p-4">
                <p className="text-sm text-myth-ink-muted leading-relaxed">
                  This action is <strong className="text-myth-danger">permanent</strong> and cannot be undone. All your:
                </p>
                <ul className="mt-3 space-y-1 text-sm text-myth-ink-muted">
                  <li>• Characters and their progress</li>
                  <li>• Campaign memberships</li>
                  <li>• Game history and actions</li>
                  <li>• Personal settings and preferences</li>
                </ul>
                <p className="mt-3 text-sm text-myth-ink-muted">
                  will be <strong className="text-myth-danger">permanently deleted</strong>.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-myth-ink-muted mb-2">
                  Type <span className="text-myth-danger font-mono">DELETE MY ACCOUNT</span> to confirm:
                </label>
                <Input
                  wrapperClassName="w-full" className="font-mono"
                  type="text"
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                  placeholder="DELETE MY ACCOUNT"
                />
              </div>

              {deleteMessage && (
                <p className={`flex items-center gap-1.5 text-sm ${
                  deleteMessage.ok ? 'text-myth-good' : 'text-myth-danger'
                }`}>
                  {deleteMessage.ok ? <UI_ICONS.success className="h-4 w-4" /> : <UI_ICONS.failure className="h-4 w-4" />}
                  {deleteMessage.text}
                </p>
              )}

              <div className="flex gap-3 pt-4">
                <Button
                  variant="danger" fullWidth
                  onClick={handleDeleteAccount}
                  disabled={deletingAccount || deleteConfirmation !== 'DELETE MY ACCOUNT'}
                >
                  {deletingAccount ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
                      Deleting...
                    </div>
                  ) : (
                    'Delete My Account'
                  )}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowDeleteModal(false)
                    setDeleteMessage(null)
                    setDeleteConfirmation('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      </main>

      <TavernNav campaignId={lastCampaignId || undefined} />
    </TavernPage>
  )
}
