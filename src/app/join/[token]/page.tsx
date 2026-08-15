// src/app/join/[token]/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { AlertTriangle, Dices } from 'lucide-react'
import { authenticatedFetch, isAuthenticated } from '@/lib/clientAuth'
import { fontDisplay, fontSans } from '@/lib/fonts'
import { TavernBackground } from '@/components/tavern/TavernBackground'
import { TavernButton } from '@/components/tavern/ui'
import { Button } from '@/components/ui/button'

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
      <div className={`${fontSans.className} -mx-4 -my-8 flex min-h-screen items-center justify-center p-4`}>
        <TavernBackground variant="myth" />
        <div className="w-full max-w-md rounded-lg border border-myth-border bg-myth-surface p-8 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.16)]">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-3/4 rounded bg-myth-surface-sunken" />
            <div className="h-4 w-full rounded bg-myth-surface-sunken" />
            <div className="h-4 w-5/6 rounded bg-myth-surface-sunken" />
          </div>
        </div>
      </div>
    )
  }

  if (error && !campaign) {
    return (
      <div className={`${fontSans.className} -mx-4 -my-8 flex min-h-screen items-center justify-center p-4`}>
        <TavernBackground variant="myth" />
        <div className="w-full max-w-md rounded-lg border border-myth-border bg-myth-surface p-8 text-center shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.16)]">
          <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-myth-danger" />
          <h1 className={`${fontDisplay.className} mb-4 text-2xl font-semibold text-myth-ink`}>Invalid Invite</h1>
          <p className="mb-6 text-myth-ink-muted">{error}</p>
          <TavernButton theme="myth" onClick={() => router.push('/campaigns')}>Go to My Campaigns</TavernButton>
        </div>
      </div>
    )
  }

  return (
    <div className={`${fontSans.className} -mx-4 -my-8 flex min-h-screen items-center justify-center p-4`}>
      <TavernBackground variant="myth" />
      <div className="w-full max-w-md rounded-lg border border-myth-border bg-myth-surface p-8 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.16)]">
        <div className="mb-6 text-center">
          <Dices className="mx-auto mb-4 h-10 w-10 text-myth-accent" />
          <h1 className={`${fontDisplay.className} mb-2 text-2xl font-semibold text-myth-ink`}>Join Campaign</h1>
        </div>

        {campaign && (
          <div className="space-y-4">
            <div className="rounded-lg border border-myth-border bg-myth-surface-sunken p-4">
              <h2 className="mb-2 text-xl font-semibold text-myth-ink">{campaign.title}</h2>
              {campaign.description && (
                <p className="mb-2 text-sm text-myth-ink-muted">{campaign.description}</p>
              )}
              {campaign.universe && (
                <p className="text-xs text-myth-ink-faint">
                  <span className="font-semibold">Universe:</span> {campaign.universe}
                </p>
              )}
            </div>

            {error && (
              <div className="rounded-lg border border-myth-danger/30 bg-myth-danger/10 p-3">
                <p className="text-sm text-myth-danger">{error}</p>
              </div>
            )}

            {isExpired && (
              <div className="rounded-lg border border-myth-warn/30 bg-myth-warn/10 p-3">
                <p className="text-sm text-myth-warn">This invite link has expired</p>
              </div>
            )}

            {isExhausted && (
              <div className="rounded-lg border border-myth-warn/30 bg-myth-warn/10 p-3">
                <p className="text-sm text-myth-warn">This invite link has reached its maximum uses</p>
              </div>
            )}

            {canJoin ? (
              <TavernButton theme="myth" onClick={handleJoinCampaign} disabled={joining} className="w-full">
                {joining ? 'Joining…' : 'Join Campaign'}
              </TavernButton>
            ) : (
              <Button variant="secondary" fullWidth disabled>
                Cannot Join
              </Button>
            )}

            <TavernButton theme="myth" variant="secondary" onClick={() => router.push('/campaigns')} className="w-full">
              Cancel
            </TavernButton>
          </div>
        )}
      </div>
    </div>
  )
}
