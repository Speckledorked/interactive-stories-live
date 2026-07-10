// src/app/friends/page.tsx
// Friends list, requests, and search — wires up the previously-orphaned
// friends API (list/search/send/accept/reject/cancel/remove) into a page.
// Friend-request notifications already link to /friends; this is what
// makes that link resolve instead of 404ing.

'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Users, UserPlus, Search, Check, X, Clock, UserMinus } from 'lucide-react'
import { authenticatedFetch, isAuthenticated, getLastCampaignId, getUser } from '@/lib/clientAuth'
import { formatRelativeTime } from '@/lib/tavernUtils'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { TavernButton, TavernErrorBanner, TavernEmptyState, TavernSpinner } from '@/components/tavern/ui'

interface Friend {
  id: string
  email: string
  name: string | null
  isOnline: boolean
  lastSeenAt: string | null
}

interface FriendRequestUser {
  id: string
  email: string
  name: string | null
  isOnline: boolean
}

interface FriendRequest {
  id: string
  senderId: string
  receiverId: string
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED'
  message: string | null
  createdAt: string
  sender: FriendRequestUser
  receiver: FriendRequestUser
}

interface SearchResult {
  id: string
  email: string
  name: string | null
  isOnline: boolean
  isFriend: boolean
  friendRequest: { id: string; type: 'incoming' | 'outgoing' } | null
}

type TabKey = 'friends' | 'requests' | 'search'

export default function FriendsPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabKey>('friends')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastCampaignId, setLastCampaignId] = useState<string | null>(null)

  const [friends, setFriends] = useState<Friend[]>([])
  const [incoming, setIncoming] = useState<FriendRequest[]>([])
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([])

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }
    setLastCampaignId(getLastCampaignId())
    loadAll()
  }, [])

  const loadAll = async () => {
    setLoading(true)
    setError('')
    try {
      const [friendsRes, requestsRes] = await Promise.all([
        authenticatedFetch('/api/friends'),
        authenticatedFetch('/api/friends/requests'),
      ])

      if (friendsRes.ok) {
        const data = await friendsRes.json()
        setFriends(data.friends || [])
      }

      if (requestsRes.ok) {
        const data = await requestsRes.json()
        const requests: FriendRequest[] = data.requests || []
        const userId = getUser()?.id
        setIncoming(requests.filter((r) => r.status === 'PENDING' && r.receiverId === userId))
        setOutgoing(requests.filter((r) => r.status === 'PENDING' && r.senderId === userId))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load friends')
    } finally {
      setLoading(false)
    }
  }

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const res = await authenticatedFetch(`/api/friends/search?q=${encodeURIComponent(q.trim())}`)
      if (res.ok) {
        const data = await res.json()
        setSearchResults(data.users || [])
      }
    } catch (err) {
      // Non-fatal: leave previous results in place
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    const handle = setTimeout(() => runSearch(query), 350)
    return () => clearTimeout(handle)
  }, [query, runSearch])

  const sendRequest = async (receiverId: string) => {
    setPendingActionId(receiverId)
    try {
      const res = await authenticatedFetch('/api/friends/requests', {
        method: 'POST',
        body: JSON.stringify({ receiverId }),
      })
      if (res.ok) {
        setSearchResults((prev) =>
          prev.map((u) => (u.id === receiverId ? { ...u, friendRequest: { id: '', type: 'outgoing' } } : u))
        )
        await loadAll()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to send friend request')
      }
    } finally {
      setPendingActionId(null)
    }
  }

  const respondToRequest = async (requestId: string, action: 'accept' | 'reject') => {
    setPendingActionId(requestId)
    try {
      const res = await authenticatedFetch(`/api/friends/requests/${requestId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      })
      if (res.ok) {
        await loadAll()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to respond to request')
      }
    } finally {
      setPendingActionId(null)
    }
  }

  const cancelRequest = async (requestId: string) => {
    setPendingActionId(requestId)
    try {
      const res = await authenticatedFetch(`/api/friends/requests/${requestId}`, { method: 'DELETE' })
      if (res.ok) {
        await loadAll()
      }
    } finally {
      setPendingActionId(null)
    }
  }

  const removeFriend = async (friendId: string) => {
    if (!confirm('Remove this friend?')) return
    setPendingActionId(friendId)
    try {
      const res = await authenticatedFetch(`/api/friends?friendId=${friendId}`, { method: 'DELETE' })
      if (res.ok) {
        setFriends((prev) => prev.filter((f) => f.id !== friendId))
      }
    } finally {
      setPendingActionId(null)
    }
  }

  const tabs = [
    { key: 'friends' as TabKey, label: 'Friends', icon: Users },
    { key: 'requests' as TabKey, label: 'Requests', icon: Clock, badge: incoming.length },
    { key: 'search' as TabKey, label: 'Find Players', icon: Search },
  ]

  if (loading) {
    return (
      <TavernPage>
        <TavernHeader backHref="/campaigns" title="Friends" campaignId={lastCampaignId || undefined} />
        <main className="max-w-2xl mx-auto px-4 pt-28 pb-16">
          <TavernSpinner className="h-16 w-16" />
        </main>
        <TavernNav campaignId={lastCampaignId || undefined} />
      </TavernPage>
    )
  }

  return (
    <TavernPage>
      <TavernHeader
        backHref="/campaigns"
        title="Friends"
        campaignId={lastCampaignId || undefined}
        subrow={
          <nav className="max-w-2xl mx-auto px-4 flex items-center gap-1 text-sm border-t border-ember-900/20 pt-2 pb-0">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-2.5 py-2 border-b-2 transition-colors ${
                  activeTab === tab.key ? 'border-ember-400 text-ember-200' : 'border-transparent text-ember-300/40 hover:text-ember-300/70'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                {!!tab.badge && (
                  <span className="text-[10px] bg-wine-600 text-ember-100 rounded-full px-1.5 py-0.5 leading-none">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        }
      />

      <main className="max-w-2xl mx-auto px-4 pt-28 pb-28 space-y-4">
        {error && <TavernErrorBanner>{error}</TavernErrorBanner>}

        {activeTab === 'friends' && (
          <div className="space-y-3">
            {friends.length === 0 ? (
              <TavernEmptyState
                icon={Users}
                title="No friends yet"
                description="Find other players and send a friend request to see them here."
              />
            ) : (
              friends.map((friend) => (
                <div
                  key={friend.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${friend.isOnline ? 'bg-success-400' : 'bg-ember-700/50'}`}
                      title={friend.isOnline ? 'Online' : 'Offline'}
                    />
                    <div className="min-w-0">
                      <p className="text-ember-100 font-medium truncate">{friend.name || friend.email}</p>
                      <p className="text-xs text-ember-400/50">
                        {friend.isOnline
                          ? 'Online now'
                          : friend.lastSeenAt
                            ? formatRelativeTime(friend.lastSeenAt)
                            : 'Offline'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => removeFriend(friend.id)}
                    disabled={pendingActionId === friend.id}
                    className="p-2 text-ember-400/50 hover:text-wine-400 transition-colors disabled:opacity-50 touch-manipulation"
                    aria-label="Remove friend"
                  >
                    <UserMinus className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'requests' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-ember-300/70 mb-2">Incoming</h3>
              {incoming.length === 0 ? (
                <p className="text-sm text-ember-400/40">No pending requests.</p>
              ) : (
                <div className="space-y-2">
                  {incoming.map((req) => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between gap-3 rounded-lg bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 p-4"
                    >
                      <p className="text-ember-100 font-medium truncate">{req.sender.name || req.sender.email}</p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => respondToRequest(req.id, 'accept')}
                          disabled={pendingActionId === req.id}
                          className="p-2 text-success-400 hover:text-success-300 transition-colors disabled:opacity-50 touch-manipulation"
                          aria-label="Accept"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => respondToRequest(req.id, 'reject')}
                          disabled={pendingActionId === req.id}
                          className="p-2 text-wine-400 hover:text-wine-300 transition-colors disabled:opacity-50 touch-manipulation"
                          aria-label="Reject"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-ember-300/70 mb-2">Sent</h3>
              {outgoing.length === 0 ? (
                <p className="text-sm text-ember-400/40">No pending sent requests.</p>
              ) : (
                <div className="space-y-2">
                  {outgoing.map((req) => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between gap-3 rounded-lg bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 p-4"
                    >
                      <p className="text-ember-100 font-medium truncate">{req.receiver.name || req.receiver.email}</p>
                      <button
                        onClick={() => cancelRequest(req.id)}
                        disabled={pendingActionId === req.id}
                        className="text-xs text-ember-400/60 hover:text-wine-400 transition-colors disabled:opacity-50 touch-manipulation"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'search' && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 text-ember-400/50 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full pl-9 pr-4 py-2.5 bg-black/30 border border-ember-900/40 rounded-lg text-ember-100 placeholder:text-ember-400/40 focus:border-ember-500/60 focus:outline-none"
              />
            </div>

            {searching && <TavernSpinner className="h-8 w-8" />}

            {!searching && query.trim().length >= 2 && searchResults.length === 0 && (
              <p className="text-sm text-ember-400/40 text-center py-4">No players found.</p>
            )}

            <div className="space-y-2">
              {searchResults.map((result) => (
                <div
                  key={result.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 p-4"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${result.isOnline ? 'bg-success-400' : 'bg-ember-700/50'}`} />
                    <p className="text-ember-100 font-medium truncate">{result.name || result.email}</p>
                  </div>
                  {result.isFriend ? (
                    <span className="text-xs text-ember-400/40 flex-shrink-0">Already friends</span>
                  ) : result.friendRequest?.type === 'outgoing' ? (
                    <span className="text-xs text-ember-400/40 flex-shrink-0">Request sent</span>
                  ) : result.friendRequest?.type === 'incoming' ? (
                    <span className="text-xs text-ember-400/40 flex-shrink-0">Check Requests tab</span>
                  ) : (
                    <TavernButton
                      onClick={() => sendRequest(result.id)}
                      disabled={pendingActionId === result.id}
                      className="!py-1.5 !px-3 text-xs flex-shrink-0"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Add
                    </TavernButton>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <TavernNav campaignId={lastCampaignId || undefined} />
    </TavernPage>
  )
}
