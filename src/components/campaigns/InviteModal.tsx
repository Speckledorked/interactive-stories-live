// src/components/campaigns/InviteModal.tsx
'use client'

import { useState, useEffect } from 'react'
import { X, Check } from 'lucide-react'
import { authenticatedFetch } from '@/lib/clientAuth'
import { Button } from '@/components/ui/button'

interface InviteModalProps {
  campaignId: string
  isOpen: boolean
  onClose: () => void
}

interface Invite {
  id: string
  token: string
  joinUrl: string
  uses: number
  maxUses: number
  expiresAt: string
  isExpired: boolean
  isExhausted: boolean
}

export default function InviteModal({ campaignId, isOpen, onClose }: InviteModalProps) {
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      fetchInvites()
    }
  }, [isOpen, campaignId])

  const fetchInvites = async () => {
    setLoading(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/invites`)
      if (response.ok) {
        const data = await response.json()
        setInvites(data.invites || [])
      }
    } catch (error) {
      console.error('Failed to fetch invites:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateInvite = async () => {
    setCreating(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (response.ok) {
        await fetchInvites()
      }
    } catch (error) {
      console.error('Failed to create invite:', error)
    } finally {
      setCreating(false)
    }
  }

  const handleCopyLink = async (invite: Invite) => {
    try {
      await navigator.clipboard.writeText(invite.joinUrl)
      setCopiedToken(invite.token)
      setTimeout(() => setCopiedToken(null), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-myth-surface-sunken flex items-center justify-center p-4 z-50">
      <div className="bg-myth-surface-raised border border-myth-border rounded-lg shadow-2xl shadow-black/50 max-w-2xl w-full max-h-[80vh] overflow-hidden">
        <div className="p-6 border-b border-myth-border">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-myth-ink">Campaign Invites</h2>
            <button
              onClick={onClose}
              className="text-myth-ink-faint hover:text-myth-ink transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[60vh]">
          <Button variant="primary" size="lg" fullWidth
            className="mb-6"
            onClick={handleCreateInvite}
            disabled={creating}
          >
            {creating ? 'Creating...' : '+ Create New Invite Link'}
          </Button>

          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-myth-accent mx-auto"></div>
              <p className="text-myth-ink-faint mt-2">Loading invites...</p>
            </div>
          ) : invites.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-myth-ink-faint">No invite links yet. Create one to invite players!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {invites.map((invite) => (
                <div
                  key={invite.id}
                  className={`bg-myth-surface-sunken border border-myth-border rounded-lg p-4 ${
                    invite.isExpired || invite.isExhausted
                      ? 'opacity-50'
                      : ''
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <p className="text-xs text-myth-gold font-mono mb-1">
                        {invite.token}
                      </p>
                      <div className="flex items-center gap-2 text-sm text-myth-ink">
                        <span>Uses: {invite.uses} / {invite.maxUses === 0 ? '∞' : invite.maxUses}</span>
                        <span>•</span>
                        <span>
                          Expires: {new Date(invite.expiresAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    {invite.isExpired && (
                      <span className="text-xs bg-myth-danger text-myth-danger px-2 py-1 rounded">
                        Expired
                      </span>
                    )}
                    {invite.isExhausted && (
                      <span className="text-xs bg-myth-surface-sunken text-myth-ink-muted px-2 py-1 rounded">
                        Max Uses
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-3">
                    <input
                      type="text"
                      value={invite.joinUrl}
                      readOnly
                      className="flex-1 bg-myth-surface-sunken border border-myth-border text-myth-ink-muted px-3 py-2 rounded text-sm font-mono"
                    />
                    <button
                      onClick={() => handleCopyLink(invite)}
                      disabled={invite.isExpired || invite.isExhausted}
                      className="flex items-center gap-1.5 bg-success-600 hover:bg-success-500 disabled:opacity-50 text-myth-accent-ink px-4 py-2 rounded text-sm font-semibold transition"
                    >
                      {copiedToken === invite.token ? (
                        <>
                          <Check className="w-4 h-4" /> Copied
                        </>
                      ) : (
                        'Copy'
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-myth-border">
          <Button variant="secondary" fullWidth
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
