// src/components/campaigns/InviteModal.tsx
'use client'

import { useState, useEffect } from 'react'
import { authenticatedFetch } from '@/lib/clientAuth'

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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
        <div className="p-6 border-b border-gray-700">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-white">Campaign Invites</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition"
            >
              
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[60vh]">
          <button
            onClick={handleCreateInvite}
            disabled={creating}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-3 px-4 rounded-lg transition mb-6"
          >
            {creating ? 'Creating...' : '+ Create New Invite Link'}
          </button>

          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
              <p className="text-gray-400 mt-2">Loading invites...</p>
            </div>
          ) : invites.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-400">No invite links yet. Create one to invite players!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {invites.map((invite) => (
                <div
                  key={invite.id}
                  className={`bg-gray-700 rounded-lg p-4 ${
                    invite.isExpired || invite.isExhausted
                      ? 'opacity-50'
                      : ''
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <p className="text-xs text-gray-400 font-mono mb-1">
                        {invite.token}
                      </p>
                      <div className="flex items-center gap-2 text-sm text-gray-300">
                        <span>Uses: {invite.uses} / {invite.maxUses === 0 ? '' : invite.maxUses}</span>
                        <span>"</span>
                        <span>
                          Expires: {new Date(invite.expiresAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    {invite.isExpired && (
                      <span className="text-xs bg-red-900 text-red-300 px-2 py-1 rounded">
                        Expired
                      </span>
                    )}
                    {invite.isExhausted && (
                      <span className="text-xs bg-yellow-900 text-yellow-300 px-2 py-1 rounded">
                        Max Uses
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-3">
                    <input
                      type="text"
                      value={invite.joinUrl}
                      readOnly
                      className="flex-1 bg-gray-600 text-gray-200 px-3 py-2 rounded text-sm font-mono"
                    />
                    <button
                      onClick={() => handleCopyLink(invite)}
                      disabled={invite.isExpired || invite.isExhausted}
                      className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white px-4 py-2 rounded text-sm font-semibold transition"
                    >
                      {copiedToken === invite.token ? ' Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-700">
          <button
            onClick={onClose}
            className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
