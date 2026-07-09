'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { User, Home, Scroll } from 'lucide-react'
import { authenticatedFetch, isAuthenticated } from '@/lib/clientAuth'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { TavernCard, TavernSpinner } from '@/components/tavern/ui'

export default function CharactersListPage() {
  const router = useRouter()
  const params = useParams()
  const campaignId = params.id as string

  const [characters, setCharacters] = useState<any[]>([])
  const [campaign, setCampaign] = useState<any>(null)
  const [userRole, setUserRole] = useState<'ADMIN' | 'PLAYER' | null>(null)
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

      const campaignResponse = await authenticatedFetch(
        `/api/campaigns/${campaignId}`
      )
      if (campaignResponse.ok) {
        const campaignData = await campaignResponse.json()
        setCampaign(campaignData.campaign)
        setUserRole(campaignData.userRole)

        if (campaignData.campaign?.characters) {
          setCharacters(campaignData.campaign.characters)
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
      <TavernPage>
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Characters" campaignId={campaignId} />
        <main className="max-w-6xl mx-auto px-4 pt-28 pb-16">
          <TavernSpinner className="h-16 w-16" />
        </main>
      </TavernPage>
    )
  }

  if (error || !campaign) {
    return (
      <TavernPage>
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Characters" campaignId={campaignId} />
        <main className="max-w-6xl mx-auto px-4 pt-28 pb-16 text-center">
          <h2 className="text-2xl font-bold text-wine-400 mb-4">Error</h2>
          <p className="text-ember-300/60 mb-4">{error || 'Campaign not found'}</p>
          <Link href="/campaigns" className="text-ember-300 hover:text-ember-200">
            ← Back to Campaigns
          </Link>
        </main>
      </TavernPage>
    )
  }

  return (
    <TavernPage>
      <TavernHeader
        backHref={`/campaigns/${campaignId}`}
        title="Characters"
        campaignId={campaignId}
        isAdmin={userRole === 'ADMIN'}
        subrow={
          <nav className="max-w-6xl mx-auto px-4 flex items-center gap-1 text-sm border-t border-ember-900/20 pt-2 pb-0">
            <Link
              href={`/campaigns/${campaignId}`}
              className="flex items-center gap-1.5 px-2.5 py-2 border-b-2 border-transparent text-ember-300/40 hover:text-ember-300/70 transition-colors"
            >
              <Home className="w-3.5 h-3.5" />
              Overview
            </Link>
            <Link
              href={`/campaigns/${campaignId}/story`}
              className="flex items-center gap-1.5 px-2.5 py-2 border-b-2 border-transparent text-ember-300/40 hover:text-ember-300/70 transition-colors"
            >
              <Scroll className="w-3.5 h-3.5" />
              Story
            </Link>
            <span className="flex items-center gap-1.5 px-2.5 py-2 border-b-2 border-ember-400 text-ember-200">
              <User className="w-3.5 h-3.5" />
              Characters
            </span>
          </nav>
        }
      />

      <main className="max-w-6xl mx-auto px-4 pt-28 pb-28">
        {characters.length === 0 ? (
          <TavernCard className="p-12 text-center">
            <p className="text-ember-300/60 mb-4">No characters in this campaign yet.</p>
            <Link href={`/campaigns/${campaignId}`} className="text-ember-300 hover:text-ember-200">
              Go to campaign overview to create a character
            </Link>
          </TavernCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {characters.map((character: any) => (
              <Link
                key={character.id}
                href={`/campaigns/${campaignId}/characters/${character.id}`}
                className="group block p-6 rounded-2xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 hover:border-ember-700/50 shadow-lg shadow-black/30 transition-all duration-200"
              >
                <div className="flex items-start justify-between mb-4">
                  <h3 className="text-xl font-bold text-ember-100 group-hover:text-ember-300 transition-colors">{character.name}</h3>
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-ember-900/30 text-ember-300 border border-ember-800/40">
                    Lvl {character.level || 1}
                  </span>
                </div>

                {character.class && (
                  <p className="text-ember-200/70 text-sm mb-3 font-medium">{character.class}</p>
                )}

                {character.description && (
                  <p className="text-ember-300/60 text-sm line-clamp-2 mb-4 leading-relaxed">
                    {character.description}
                  </p>
                )}

                {character.stats && (
                  <div className="grid grid-cols-3 gap-3 text-xs mb-4">
                    {Object.entries(character.stats as Record<string, number>)
                      .slice(0, 6)
                      .map(([stat, value]) => (
                        <div key={stat} className="text-center p-2 bg-black/25 rounded-lg border border-ember-900/30">
                          <div className="text-ember-400/50 uppercase font-medium mb-1">{stat}</div>
                          <div className="text-ember-100 font-bold text-base">{value}</div>
                        </div>
                      ))}
                  </div>
                )}

                {character.user && (
                  <div className="mt-4 pt-4 border-t border-ember-900/30">
                    <p className="text-xs text-ember-400/50 flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {character.user.email || character.user.name || 'Unknown'}
                    </p>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </main>

      <TavernNav active="characters" campaignId={campaignId} />
    </TavernPage>
  )
}
