// src/app/join/[token]/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface CampaignInfo {
  id: string
  title: string
  description: string
  universe: string
}

export default function JoinPage({
  params
}: {
  params: { token: string }
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [campaign, setCampaign] = useState<CampaignInfo | null>(null)

  useEffect(() => {
    const loadInvite = async () => {
      try {
        setLoading(true)
        setError(null)

        const res = await fetch(`/api/campaigns/join/validate?token=${encodeURIComponent(params.token)}`)
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.error || 'This invite link is invalid or has expired.')
        }

        const data = await res.json()
        setCampaign(data.campaign)
      } catch (err: any) {
        console.error('Error loading invite:', err)
        setError(err.message || 'Failed to load invite. Please try again later.')
      } finally {
        setLoading(false)
      }
    }

    loadInvite()
  }, [params.token])

  const handleJoin = async () => {
    if (!campaign) return

    try {
      setJoining(true)
      setError(null)

      const res = await fetch('/api/campaigns/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token: params.token })
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || 'Failed to join campaign.')
      }

      const data = await res.json()

      // Redirect to the campaign page
      router.push(`/campaigns/${data.campaignId}`)
    } catch (err: any) {
      console.error('Error joining campaign:', err)
      setError(err.message || 'Failed to join campaign.')
    } finally {
      setJoining(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
        <div className="max-w-md w-full px-6">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="animate-pulse space-y-4">
              <div className="h-6 bg-slate-800 rounded w-1/3" />
              <div className="h-4 bg-slate-800 rounded w-full" />
              <div className="h-4 bg-slate-800 rounded w-2/3" />
              <div className="h-10 bg-slate-800 rounded w-1/2 mt-4" />
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
      <div className="max-w-md w-full px-6">
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
          <div className="space-y-2">
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-sky-400">
              Campaign Invitation
            </p>
            <h1 className="text-2xl font-semibold text-slate-50">
              Join {campaign?.title || 'this campaign'}
            </h1>
            {campaign?.universe && (
              <p className="text-xs font-mono text-slate-400">
                Universe: <span className="text-sky-300">{campaign.universe}</span>
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-100">
              {error}
            </div>
          )}

          {campaign && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-3 text-sm text-slate-200 space-y-1">
              <p className="font-medium text-slate-50">{campaign.title}</p>
              {campaign.description && (
                <p className="text-slate-300 text-sm">
                  {campaign.description}
                </p>
              )}
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={handleJoin}
              disabled={joining || !!error || !campaign}
              className="w-full inline-flex items-center justify-center rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-slate-950 shadow-sm hover:bg-sky-400 disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {joining ? 'Joining...' : 'Join Campaign'}
            </button>

            <Link
              href="/"
              className="block text-center text-xs text-slate-400 hover:text-slate-200 transition"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
