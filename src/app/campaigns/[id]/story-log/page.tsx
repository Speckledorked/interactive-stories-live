'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { authenticatedFetch, isAuthenticated } from '@/lib/clientAuth'

interface Scene {
  id: string
  sceneNumber: number
  status: string
  sceneResolutionText: string | null
  createdAt: string
  playerActions: Array<{
    id: string
    actionText: string
    user: {
      id: string
      email: string
      name: string | null
    }
  }>
}

interface Campaign {
  id: string
  name: string
  description: string | null
}

export default function StoryLogPage() {
  const params = useParams()
  const router = useRouter()
  const campaignId = params?.id as string

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    if (campaignId) {
      loadScenes()
    }
  }, [campaignId])

  const loadScenes = async () => {
    try {
      // Load campaign info
      const campaignResponse = await authenticatedFetch(`/api/campaigns/${campaignId}`)
      if (campaignResponse.ok) {
        const campaignData = await campaignResponse.json()
        setCampaign(campaignData.campaign)
      }

      // Load all scenes
      const scenesResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/scenes`)
      if (scenesResponse.ok) {
        const scenesData = await scenesResponse.json()
        setScenes(scenesData.scenes || [])
      } else {
        setError('Failed to load scenes')
      }
    } catch (err) {
      setError('Failed to load story log')
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'AWAITING_ACTIONS':
        return <span className="badge bg-primary-900/30 border-primary-700/50 text-primary-400">Active</span>
      case 'RESOLVING':
        return <span className="badge bg-warning-900/30 border-warning-700/50 text-warning-400">Resolving</span>
      case 'RESOLVED':
        return <span className="badge bg-success-900/30 border-success-700/50 text-success-400">Resolved</span>
      default:
        return <span className="badge bg-gray-700/30 border-gray-600/50 text-gray-400">{status}</span>
    }
  }

  const truncateText = (text: string | null, maxLength: number = 150) => {
    if (!text) return 'No resolution yet...'
    if (text.length <= maxLength) return text
    return text.slice(0, maxLength) + '...'
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <div className="relative">
          <div className="spinner h-16 w-16"></div>
          <div className="absolute inset-0 h-16 w-16 rounded-full bg-primary-500/20 animate-ping"></div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="card bg-gradient-to-br from-danger-900/20 to-danger-800/10 border-danger-700/30">
          <p className="text-danger-400">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto animate-fade-in">
      <div className="mb-12">
        <Link
          href={`/campaigns/${campaignId}`}
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition-colors group"
        >
          <svg className="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Campaign
        </Link>

        <div className="relative">
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-primary-500/10 via-accent-500/5 to-transparent blur-3xl"></div>
          <h1 className="text-5xl font-bold tracking-tight bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent mb-3">
            Story Log
          </h1>
          <p className="text-lg text-gray-400">
            {campaign?.name || 'Campaign'} - Complete history of all scenes
          </p>
        </div>
      </div>

      {/* Stats Card */}
      <div className="card mb-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-primary-500/10 to-transparent blur-3xl"></div>
        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center">
            <div className="text-4xl font-bold bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent mb-2">
              {scenes.length}
            </div>
            <div className="text-sm text-gray-400">Total Scenes</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold bg-gradient-to-r from-success-400 to-success-600 bg-clip-text text-transparent mb-2">
              {scenes.filter(s => s.sceneResolutionText).length}
            </div>
            <div className="text-sm text-gray-400">Resolved Scenes</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold bg-gradient-to-r from-warning-400 to-warning-600 bg-clip-text text-transparent mb-2">
              {scenes.filter(s => s.status === 'AWAITING_ACTIONS').length}
            </div>
            <div className="text-sm text-gray-400">Active Scenes</div>
          </div>
        </div>
      </div>

      {/* Scenes List */}
      <div className="space-y-4">
        {scenes.length === 0 ? (
          <div className="card text-center py-12">
            <div className="text-6xl mb-4">📖</div>
            <p className="text-xl text-gray-400 mb-2">No scenes yet</p>
            <p className="text-sm text-gray-500">Scenes will appear here as your adventure unfolds</p>
          </div>
        ) : (
          scenes
            .sort((a, b) => b.sceneNumber - a.sceneNumber)
            .map((scene, index) => (
              <Link
                key={scene.id}
                href={`/campaigns/${campaignId}/story`}
                className="block"
              >
                <div
                  className="card group hover:border-primary-700/50 hover:shadow-glow transition-all duration-200 cursor-pointer"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="text-3xl font-bold bg-gradient-to-r from-primary-400 to-accent-400 bg-clip-text text-transparent">
                        #{scene.sceneNumber}
                      </div>
                      {getStatusBadge(scene.status)}
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(scene.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>

                  {/* Scene Summary */}
                  <div className="mb-4">
                    <p className="text-gray-300 leading-relaxed">
                      {truncateText(scene.sceneResolutionText)}
                    </p>
                  </div>

                  {/* Participants */}
                  {scene.playerActions.length > 0 && (
                    <div className="pt-4 border-t border-dark-700/50">
                      <div className="flex items-center gap-2 text-sm">
                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                        <span className="text-gray-500">Participants:</span>
                        <div className="flex items-center gap-2 flex-wrap">
                          {Array.from(new Set(scene.playerActions.map(a => a.user.id))).map(userId => {
                            const user = scene.playerActions.find(a => a.user.id === userId)?.user
                            return (
                              <span
                                key={userId}
                                className="text-xs bg-dark-800/50 text-gray-400 px-2 py-1 rounded border border-dark-700/50"
                              >
                                {user?.name || user?.email || 'Unknown'}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-gray-500">
                        {scene.playerActions.length} action{scene.playerActions.length !== 1 ? 's' : ''} submitted
                      </div>
                    </div>
                  )}

                  {/* View link indicator */}
                  <div className="mt-4 flex items-center gap-2 text-sm text-primary-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span>View in Story</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </Link>
            ))
        )}
      </div>
    </div>
  )
}
