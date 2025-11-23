// src/app/join/[token]/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { authenticatedFetch, isAuthenticated } from '@/lib/clientAuth'

interface CampaignInfo {
  id: string
  title: string
  description: string | null
  universe: string | null
}

export default function JoinCampaignPage() {
  const router = useRouter()
  const params = useParams()
  const token = params.token as string

  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [campaign, setCampaign] = useState<CampaignInfo | null>(null)
  const [error, setError] = useState('')
  const [canJoin, setCanJoin] = useState(false)
  const [isExpired, setIsExpired] = useState(false)
  const [isExhausted, setIsExhausted] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) {
      // Redirect to login with return URL
      router.push(`/login?returnTo=/join/${token}`)
      return
    }

    fetchInviteDetails()
  }, [token])

  const fetchInviteDetails = async () => {
    try {
      const response = await fetch(`/api/join/${token}`)

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Invalid invite link')
      }

      const data = await response.json()
      setCampaign(data.campaign)
      setCanJoin(data.canJoin)
      setIsExpired(data.isExpired)
      setIsExhausted(data.isExhausted)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invite')
    } finally {
      setLoading(false)
    }
  }

  const handleJoinCampaign = async () => {
    setJoining(true)
    setError('')

    try {
      const response = await authenticatedFetch(`/api/join/${token}`, {
        method: 'POST',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to join campaign')
      }

      const data = await response.json()

      // Redirect to campaign page
      router.push(`/campaigns/${data.campaignId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join campaign')
      setJoining(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-lg shadow-2xl p-8 max-w-md w-full">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-700 rounded w-3/4"></div>
            <div className="h-4 bg-gray-700 rounded w-full"></div>
            <div className="h-4 bg-gray-700 rounded w-5/6"></div>
          </div>
        </div>
      </div>
    )
  }

  if (error && !campaign) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-lg shadow-2xl p-8 max-w-md w-full">
          <div className="text-center">
            <div className="text-red-500 text-5xl mb-4">⚠️</div>
            <h1 className="text-2xl font-bold text-white mb-4">Invalid Invite</h1>
            <p className="text-gray-300 mb-6">{error}</p>
            <button
              onClick={() => router.push('/campaigns')}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition"
            >
              Go to My Campaigns
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-lg shadow-2xl p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <div className="text-blue-500 text-5xl mb-4">🎲</div>
          <h1 className="text-2xl font-bold text-white mb-2">Join Campaign</h1>
        </div>

        {campaign && (
          <div className="space-y-4">
            <div className="bg-gray-700 rounded-lg p-4">
              <h2 className="text-xl font-semibold text-white mb-2">
                {campaign.title}
              </h2>
              {campaign.description && (
                <p className="text-gray-300 text-sm mb-2">
                  {campaign.description}
                </p>
              )}
              {campaign.universe && (
                <p className="text-gray-400 text-xs">
                  <span className="font-semibold">Universe:</span> {campaign.universe}
                </p>
              )}
            </div>

            {error && (
              <div className="bg-red-900/50 border border-red-700 rounded-lg p-3">
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            )}

            {isExpired && (
              <div className="bg-yellow-900/50 border border-yellow-700 rounded-lg p-3">
                <p className="text-yellow-300 text-sm">
                  ⚠️ This invite link has expired
                </p>
              </div>
            )}

            {isExhausted && (
              <div className="bg-yellow-900/50 border border-yellow-700 rounded-lg p-3">
                <p className="text-yellow-300 text-sm">
                  ⚠️ This invite link has reached its maximum uses
                </p>
              </div>
            )}

            {canJoin ? (
              <button
                onClick={handleJoinCampaign}
                disabled={joining}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition"
              >
                {joining ? 'Joining...' : 'Join Campaign'}
              </button>
            ) : (
              <button
                disabled
                className="w-full bg-gray-600 cursor-not-allowed text-gray-400 font-semibold py-3 px-6 rounded-lg"
              >
                Cannot Join
              </button>
            )}

            <button
              onClick={() => router.push('/campaigns')}
              className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-6 rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
