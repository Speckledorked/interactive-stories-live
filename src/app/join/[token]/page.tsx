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
  const [error, setError] = useState('')
  const [campaign, setCampaign] = useState<CampaignInfo | null>(null)
  const [canJoin, setCanJoin] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    checkAuth()
    fetchInviteDetails()
  }, [])

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/auth/me')
      setIsAuthenticated(response.ok)
    } catch (error) {
      setIsAuthenticated(false)
    }
  }

  const fetchInviteDetails = async () => {
    try {
      const response = await fetch(`/api/join/${params.token}`)
      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Invalid invite link')
        return
      }

      setCampaign(data.campaign)
      setCanJoin(data.canJoin)

      if (!data.canJoin) {
        if (data.isExpired) {
          setError('This invite link has expired')
        } else if (data.isExhausted) {
          setError('This invite link has reached its maximum uses')
        }
      }
    } catch (err) {
      setError('Failed to load invite details')
    } finally {
      setLoading(false)
    }
  }

  const handleJoin = async () => {
    if (!isAuthenticated) {
      // Redirect to login, then back here
      router.push(`/login?redirect=/join/${params.token}`)
      return
    }

    setJoining(true)
    setError('')

    try {
      const response = await fetch(`/api/join/${params.token}`, {
        method: 'POST',
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to join campaign')
        return
      }

      // Redirect to the campaign
      router.push(`/campaigns/${data.campaignId}`)
    } catch (err) {
      setError('Something went wrong')
    } finally {
      setJoining(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading invite details...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Campaign Invitation
          </h2>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-900 px-4 py-3 rounded-md">
            {error}
          </div>
        )}

        {campaign && (
          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {campaign.title}
            </h3>
            
            {campaign.universe && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 mb-3">
                {campaign.universe}
              </span>
            )}

            {campaign.description && (
              <p className="text-gray-600 mb-4">{campaign.description}</p>
            )}

            {canJoin && (
              <div className="space-y-4">
                {!isAuthenticated ? (
                  <>
                    <p className="text-sm text-gray-500">
                      You need to log in or create an account to join this campaign.
                    </p>
                    <div className="flex space-x-3">
                      <Link
                        href={`/login?redirect=/join/${params.token}`}
                        className="flex-1 text-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                      >
                        Log In
                      </Link>
                      <Link
                        href={`/register?redirect=/join/${params.token}`}
                        className="flex-1 text-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                      >
                        Sign Up
                      </Link>
                    </div>
                  </>
                ) : (
                  <button
                    onClick={handleJoin}
                    disabled={joining}
                    className="w-full px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                  >
                    {joining ? 'Joining...' : 'Join Campaign'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {!campaign && !error && (
          <div className="bg-white shadow rounded-lg p-6 text-center">
            <p className="text-gray-500">Invalid invite link</p>
          </div>
        )}
      </div>
    </div>
  )
}
