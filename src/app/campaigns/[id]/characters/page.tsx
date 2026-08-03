'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { User, Home, Scroll } from 'lucide-react'
import { authenticatedFetch, isAuthenticated, setLastCampaignId } from '@/lib/clientAuth'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { SubNavTabs } from '@/components/ui/SubNavTabs'
import { EmptyState } from '@/components/ui/empty-state'

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
        setLastCampaignId(campaignId)

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
      <TavernPage background="myth">
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Characters" campaignId={campaignId} variant="myth" />
        <main className="max-w-6xl mx-auto px-4 pt-28 pb-16">
          <div className="flex justify-center py-16">
            <div className="h-16 w-16 animate-spin rounded-full border-b-2 border-myth-accent" />
          </div>
        </main>
      </TavernPage>
    )
  }

  if (error || !campaign) {
    return (
      <TavernPage background="myth">
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Characters" campaignId={campaignId} variant="myth" />
        <main className="max-w-6xl mx-auto px-4 pt-28 pb-16 text-center">
          <h2 className="mb-4 text-2xl font-bold text-myth-danger">Error</h2>
          <p className="mb-4 text-myth-ink-muted">{error || 'Campaign not found'}</p>
          <Link href="/campaigns" className="text-myth-accent hover:text-myth-accent-hover">
            ← Back to Campaigns
          </Link>
        </main>
      </TavernPage>
    )
  }

  return (
    <TavernPage background="myth">
      <TavernHeader
        backHref={`/campaigns/${campaignId}`}
        title="Characters"
        campaignId={campaignId}
        isAdmin={userRole === 'ADMIN'}
        variant="myth"
        subrow={
          <nav className="max-w-6xl mx-auto px-4 flex items-center gap-1 text-sm border-t border-myth-border pt-2 pb-0">
            <SubNavTabs
              tabs={[
                { key: 'overview', label: 'Overview', icon: Home, href: `/campaigns/${campaignId}` },
                { key: 'story', label: 'Story', icon: Scroll, href: `/campaigns/${campaignId}/story` },
                { key: 'characters', label: 'Characters', icon: User },
              ]}
              activeKey="characters"
              variant="myth"
            />
          </nav>
        }
      />

      <main className="max-w-6xl mx-auto px-4 pt-28 pb-28">
        {characters.length === 0 ? (
          <EmptyState
            title="No characters in this campaign yet."
            description="Go to the campaign overview to create a character."
            action={{ label: 'Go to overview', href: `/campaigns/${campaignId}` }}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {characters.map((character: any) => (
              <Link
                key={character.id}
                href={`/campaigns/${campaignId}/characters/${character.id}`}
                className="group block rounded-lg border border-myth-border bg-myth-surface p-6 transition-colors hover:border-myth-border-strong"
              >
                <div className="mb-4 flex items-start justify-between">
                  <h3 className="font-display text-xl font-semibold text-myth-ink">{character.name}</h3>
                </div>

                {character.class && (
                  <p className="mb-3 text-sm font-medium text-myth-ink-muted">{character.class}</p>
                )}

                {character.description && (
                  <p className="mb-4 line-clamp-2 text-sm leading-relaxed text-myth-ink-muted">
                    {character.description}
                  </p>
                )}

                {character.stats && (
                  <div className="mb-4 grid grid-cols-3 gap-3 text-xs">
                    {Object.entries(character.stats as Record<string, number>)
                      .slice(0, 6)
                      .map(([stat, value]) => {
                        const custom = (campaign?.statLabels as any)?.[stat]
                        return (
                          <div key={stat} className="rounded-lg border border-myth-border bg-myth-surface-sunken p-2 text-center">
                            <div className={`mb-1 font-medium text-myth-ink-faint ${custom?.label ? '' : 'uppercase'}`}>
                              {custom?.label || stat}
                            </div>
                            <div className="text-base font-bold text-myth-ink">{value}</div>
                          </div>
                        )
                      })}
                  </div>
                )}

                {character.user && (
                  <div className="mt-4 border-t border-myth-border pt-4">
                    <p className="flex items-center gap-1 text-xs text-myth-ink-faint">
                      <User className="h-3 w-3" />
                      {character.user.name || character.user.email || 'Unknown'}
                    </p>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </main>

      <TavernNav active="characters" campaignId={campaignId} variant="myth" />
    </TavernPage>
  )
}
