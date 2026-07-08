// src/app/join/[token]/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { AlertTriangle, Dices } from 'lucide-react'
import { authenticatedFetch, isAuthenticated } from '@/lib/clientAuth'
import { displayFont, bodyFont } from '@/lib/tavernTheme'
import { TavernBackground } from '@/components/tavern/TavernBackground'
import { TavernButton } from '@/components/tavern/ui'

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
      router.push(`/campaigns/${data.campaignId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join campaign')
      setJoining(false)
    }
  }

  if (loading) {
    return (
      <div className={`${bodyFont.className} -mx-4 -my-8 min-h-screen flex items-center justify-center p-4`}>
        <TavernBackground />
        <div className="rounded-2xl bg-gradient-to-br from-tavern-800/80 to-tavern-900/80 border border-ember-900/40 shadow-2xl shadow-black/50 p-8 max-w-md w-full">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-black/30 rounded w-3/4" />
            <div className="h-4 bg-black/30 rounded w-full" />
            <div className="h-4 bg-black/30 rounded w-5/6" />
          </div>
        </div>
      </div>
    )
  }

  if (error && !campaign) {
    return (
      <div className={`${bodyFont.className} -mx-4 -my-8 min-h-screen flex items-center justify-center p-4`}>
        <TavernBackground />
        <div className="rounded-2xl bg-gradient-to-br from-tavern-800/80 to-tavern-900/80 border border-ember-900/40 shadow-2xl shadow-black/50 p-8 max-w-md w-full text-center">
          <AlertTriangle className="w-12 h-12 mx-auto text-wine-400 mb-4" />
          <h1 className={`${displayFont.className} text-2xl text-ember-100 mb-4`}>Invalid Invite</h1>
          <p className="text-ember-300/60 mb-6">{error}</p>
          <TavernButton onClick={() => router.push('/campaigns')}>Go to My Campaigns</TavernButton>
        </div>
      </div>
    )
  }

  return (
    <div className={`${bodyFont.className} -mx-4 -my-8 min-h-screen flex items-center justify-center p-4`}>
      <TavernBackground />
      <div className="rounded-2xl bg-gradient-to-br from-tavern-800/80 to-tavern-900/80 border border-ember-900/40 shadow-2xl shadow-black/50 p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <Dices className="w-10 h-10 mx-auto text-ember-400 mb-4" />
          <h1 className={`${displayFont.className} text-2xl text-ember-100 mb-2`}>Join Campaign</h1>
        </div>

        {campaign && (
          <div className="space-y-4">
            <div className="bg-black/25 border border-ember-900/30 rounded-lg p-4">
              <h2 className="text-xl font-semibold text-ember-100 mb-2">{campaign.title}</h2>
              {campaign.description && (
                <p className="text-ember-200/70 text-sm mb-2">{campaign.description}</p>
              )}
              {campaign.universe && (
                <p className="text-ember-400/50 text-xs">
                  <span className="font-semibold">Universe:</span> {campaign.universe}
                </p>
              )}
            </div>

            {error && (
              <div className="bg-wine-800/20 border border-wine-600/40 rounded-lg p-3">
                <p className="text-wine-400 text-sm">{error}</p>
              </div>
            )}

            {isExpired && (
              <div className="bg-ember-900/20 border border-ember-700/40 rounded-lg p-3">
                <p className="text-ember-300 text-sm">This invite link has expired</p>
              </div>
            )}

            {isExhausted && (
              <div className="bg-ember-900/20 border border-ember-700/40 rounded-lg p-3">
                <p className="text-ember-300 text-sm">This invite link has reached its maximum uses</p>
              </div>
            )}

            {canJoin ? (
              <TavernButton onClick={handleJoinCampaign} disabled={joining} className="w-full">
                {joining ? 'Joining…' : 'Join Campaign'}
              </TavernButton>
            ) : (
              <button disabled className="w-full px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/30 text-ember-500/40 font-medium cursor-not-allowed">
                Cannot Join
              </button>
            )}

            <TavernButton variant="secondary" onClick={() => router.push('/campaigns')} className="w-full">
              Cancel
            </TavernButton>
          </div>
        )}
      </div>
    </div>
  )
}
