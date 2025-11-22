'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { authenticatedFetch, isAuthenticated } from '@/lib/clientAuth'

export default function CharactersListPage() {
  const router = useRouter()
  const params = useParams()
  const campaignId = params.id as string

  const [characters, setCharacters] = useState<any[]>([])
  const [campaign, setCampaign] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    loadData()
  }, [campaignId])

  const loadData = async () => {
    try {
      setLoading(true)

      // Load campaign info
      const campaignResponse = await authenticatedFetch(
        `/api/campaigns/${campaignId}`
      )
      if (campaignResponse.ok) {
        const campaignData = await campaignResponse.json()
        setCampaign(campaignData)

        // Extract characters from campaign data
        if (campaignData.characters) {
          setCharacters(campaignData.characters)
        }
      } else {
        setError('Campaign not found')
      }
    } catch (err) {
      setError('Failed to load characters')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-center items-center min-h-[60vh]">
          <div className="relative">
            <div className="spinner h-16 w-16"></div>
            <div className="absolute inset-0 h-16 w-16 rounded-full bg-primary-500/20 animate-ping"></div>
          </div>
        </div>
      </div>
    )
  }

  if (error || !campaign) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-400 mb-4">Error</h2>
          <p className="text-gray-400 mb-4">{error || 'Campaign not found'}</p>
          <Link
            href="/campaigns"
            className="text-primary-400 hover:text-primary-300"
          >
            ← Back to Campaigns
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Navigation */}
      <div className="mb-8">
        <Link
          href={`/campaigns/${campaignId}`}
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition-colors group"
        >
          <svg className="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Campaign
        </Link>

        <div className="relative mb-6">
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-primary-500/10 via-accent-500/5 to-transparent blur-3xl"></div>
          <h1 className="text-5xl font-bold tracking-tight bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent mb-2">
            Characters
          </h1>
          <p className="text-lg text-gray-400">{campaign?.campaign?.name}</p>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-dark-700/50">
          <nav className="flex gap-2 overflow-x-auto">
            <Link
              href={`/campaigns/${campaignId}`}
              className="relative py-3 px-6 font-semibold text-sm transition-all duration-200 text-gray-400 hover:text-gray-300 hover:bg-white/5 whitespace-nowrap rounded-t-xl"
            >
              Overview
            </Link>
            <Link
              href={`/campaigns/${campaignId}/story`}
              className="relative py-3 px-6 font-semibold text-sm transition-all duration-200 text-gray-400 hover:text-gray-300 hover:bg-white/5 whitespace-nowrap rounded-t-xl"
            >
              Story
            </Link>
            <span className="relative py-3 px-6 font-semibold text-sm text-primary-400 bg-gradient-to-b from-primary-500/10 to-transparent whitespace-nowrap rounded-t-xl">
              Characters
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary-600 via-primary-500 to-primary-400 shadow-glow"></div>
            </span>
          </nav>
        </div>
      </div>

      {/* Characters Grid */}
      <div className="card">
        {characters.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 mb-4">No characters in this campaign yet.</p>
            <Link
              href={`/campaigns/${campaignId}`}
              className="text-primary-400 hover:text-primary-300"
            >
              Go to campaign overview to create a character
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {characters.map((character: any, index: number) => (
              <Link
                key={character.id}
                href={`/campaigns/${campaignId}/characters/${character.id}`}
                className="group block p-6 bg-gradient-to-br from-dark-850/80 to-dark-900/80 rounded-2xl border border-dark-700/50 hover:border-primary-500/50 transition-all duration-300 hover:shadow-card-hover hover:scale-[1.02]"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="flex items-start justify-between mb-4">
                  <h3 className="text-xl font-bold text-white group-hover:text-primary-400 transition-colors">{character.name}</h3>
                  <span className="badge badge-primary">
                    Lvl {character.level || 1}
                  </span>
                </div>

                {character.class && (
                  <p className="text-gray-300 text-sm mb-3 font-medium">{character.class}</p>
                )}

                {character.description && (
                  <p className="text-gray-400 text-sm line-clamp-2 mb-4 leading-relaxed">
                    {character.description}
                  </p>
                )}

                {/* Stats Preview */}
                {character.stats && (
                  <div className="grid grid-cols-3 gap-3 text-xs mb-4">
                    {Object.entries(character.stats as Record<string, number>)
                      .slice(0, 6)
                      .map(([stat, value]) => (
                        <div key={stat} className="text-center p-2 bg-dark-800/50 rounded-lg border border-dark-700/50">
                          <div className="text-gray-500 uppercase font-medium mb-1">{stat}</div>
                          <div className="text-white font-bold text-base">{value}</div>
                        </div>
                      ))}
                  </div>
                )}

                {/* Owner indicator */}
                {character.user && (
                  <div className="mt-4 pt-4 border-t border-dark-700/50">
                    <p className="text-xs text-gray-500 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      {character.user.email || character.user.name || 'Unknown'}
                    </p>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
