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
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4"></div>
            <p className="text-gray-400">Loading characters...</p>
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Navigation */}
      <div className="mb-6">
        <Link
          href={`/campaigns/${campaignId}`}
          className="text-gray-400 hover:text-white transition-colors text-sm mb-3 inline-block"
        >
          ← Back to Campaign
        </Link>

        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-white">Characters</h1>
            <p className="text-gray-400 text-sm">{campaign?.campaign?.name}</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 border-b border-gray-700 pb-2 overflow-x-auto">
          <Link
            href={`/campaigns/${campaignId}`}
            className="px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-t transition-colors whitespace-nowrap"
          >
            Overview
          </Link>
          <Link
            href={`/campaigns/${campaignId}/story`}
            className="px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-t transition-colors whitespace-nowrap"
          >
            Story
          </Link>
          <span className="px-4 py-2 bg-primary-600 text-white rounded-t whitespace-nowrap">
            Characters
          </span>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {characters.map((character: any) => (
              <Link
                key={character.id}
                href={`/campaigns/${campaignId}/characters/${character.id}`}
                className="block p-6 bg-gray-800 rounded-lg border border-gray-700 hover:border-primary-500 transition-all hover:shadow-lg hover:shadow-primary-500/20"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-xl font-bold text-white">{character.name}</h3>
                  <span className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300">
                    Lvl {character.level || 1}
                  </span>
                </div>

                {character.class && (
                  <p className="text-gray-400 text-sm mb-2">{character.class}</p>
                )}

                {character.description && (
                  <p className="text-gray-500 text-sm line-clamp-2 mb-3">
                    {character.description}
                  </p>
                )}

                {/* Stats Preview */}
                {character.stats && (
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {Object.entries(character.stats as Record<string, number>)
                      .slice(0, 6)
                      .map(([stat, value]) => (
                        <div key={stat} className="text-center">
                          <div className="text-gray-500 uppercase">{stat}</div>
                          <div className="text-white font-bold">{value}</div>
                        </div>
                      ))}
                  </div>
                )}

                {/* Owner indicator */}
                {character.user && (
                  <div className="mt-3 pt-3 border-t border-gray-700">
                    <p className="text-xs text-gray-500">
                      Player: {character.user.email || character.user.name || 'Unknown'}
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
