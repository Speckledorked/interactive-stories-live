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
import { TavernButton } from '@/components/tavern/ui'
import { SubNavTabs } from '@/components/ui/SubNavTabs'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'

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
      <TavernPage background="myth">
        <TavernHeader backHref="/campaigns" title="Friends" campaignId={lastCampaignId || undefined} variant="myth" />
        <main className="max-w-2xl mx-auto px-4 pt-28 pb-16">
          <div className="flex justify-center py-16">
            <div className="h-16 w-16 animate-spin rounded-full border-b-2 border-myth-accent" />
          </div>
        </main>
        <TavernNav campaignId={lastCampaignId || undefined} variant="myth" />
      </TavernPage>
    )
  }

  return (
    <TavernPage background="myth">
      <TavernHeader
        backHref="/campaigns"
        title="Friends"
        campaignId={lastCampaignId || undefined}
        variant="myth"
        subrow={
          <nav className="max-w-2xl mx-auto px-4 flex items-center gap-1 text-sm border-t border-myth-border pt-2 pb-0">
            <SubNavTabs tabs={tabs} activeKey={activeTab} onSelect={(key) => setActiveTab(key as TabKey)} variant="myth" />
          </nav>
        }
      />

      <main className="max-w-2xl mx-auto px-4 pt-28 pb-28 space-y-4">
        {error && (
          <div className="rounded-lg border border-myth-danger/30 bg-myth-danger/10 px-4 py-3 text-sm text-myth-danger">
            {error}
          </div>
        )}

        {activeTab === 'friends' && (
          <div className="space-y-3">
            {friends.length === 0 ? (
              <EmptyState
                icon={<Users className="h-6 w-6" />}
                title="No friends yet"
                description="Find other players and send a friend request to see them here."
              />
            ) : (
              friends.map((friend) => (
                <div
                  key={friend.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-myth-border bg-myth-surface p-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${friend.isOnline ? 'bg-myth-good' : 'bg-myth-ink-faint/40'}`}
                      title={friend.isOnline ? 'Online' : 'Offline'}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-myth-ink">{friend.name || friend.email}</p>
                      <p className="text-xs text-myth-ink-faint">
                        {friend.isOnline
                          ? 'Online now'
                          : friend.lastSeenAt
                            ? formatRelativeTime(friend.lastSeenAt)
                            : 'Offline'}
                      </p>
                    </div>
                  </div>
                  <Button variant="danger"
                    onClick={() => removeFriend(friend.id)}
                    disabled={pendingActionId === friend.id}
                    aria-label="Remove friend"
                  >
                    <UserMinus className="w-4 h-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'requests' && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-myth-ink-muted">Incoming</h3>
              {incoming.length === 0 ? (
                <p className="text-sm text-myth-ink-faint">No pending requests.</p>
              ) : (
                <div className="space-y-2">
                  {incoming.map((req) => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-myth-border bg-myth-surface p-4"
                    >
                      <p className="truncate font-medium text-myth-ink">{req.sender.name || req.sender.email}</p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => respondToRequest(req.id, 'accept')}
                          disabled={pendingActionId === req.id}
                          className="p-2 text-myth-good transition-colors hover:text-myth-good disabled:opacity-50 touch-manipulation"
                          aria-label="Accept"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <Button variant="danger"
                          onClick={() => respondToRequest(req.id, 'reject')}
                          disabled={pendingActionId === req.id}
                          aria-label="Reject"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-myth-ink-muted">Sent</h3>
              {outgoing.length === 0 ? (
                <p className="text-sm text-myth-ink-faint">No pending sent requests.</p>
              ) : (
                <div className="space-y-2">
                  {outgoing.map((req) => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-myth-border bg-myth-surface p-4"
                    >
                      <p className="truncate font-medium text-myth-ink">{req.receiver.name || req.receiver.email}</p>
                      <Button variant="danger" size="sm"
                        onClick={() => cancelRequest(req.id)}
                        disabled={pendingActionId === req.id}
                      >
                        Cancel
                      </Button>
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
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-myth-ink-faint" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full rounded-lg border border-myth-border bg-myth-surface py-2.5 pl-9 pr-4 text-myth-ink placeholder:text-myth-ink-faint focus:border-myth-accent focus:outline-none"
              />
            </div>

            {searching && (
              <div className="flex justify-center py-4">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-myth-accent" />
              </div>
            )}

            {!searching && query.trim().length >= 2 && searchResults.length === 0 && (
              <p className="py-4 text-center text-sm text-myth-ink-faint">No players found.</p>
            )}

            <div className="space-y-2">
              {searchResults.map((result) => (
                <div
                  key={result.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-myth-border bg-myth-surface p-4"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${result.isOnline ? 'bg-myth-good' : 'bg-myth-ink-faint/40'}`} />
                    <p className="truncate font-medium text-myth-ink">{result.name || result.email}</p>
                  </div>
                  {result.isFriend ? (
                    <span className="flex-shrink-0 text-xs text-myth-ink-faint">Already friends</span>
                  ) : result.friendRequest?.type === 'outgoing' ? (
                    <span className="flex-shrink-0 text-xs text-myth-ink-faint">Request sent</span>
                  ) : result.friendRequest?.type === 'incoming' ? (
                    <span className="flex-shrink-0 text-xs text-myth-ink-faint">Check Requests tab</span>
                  ) : (
                    <TavernButton
                      theme="myth"
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

      <TavernNav campaignId={lastCampaignId || undefined} variant="myth" />
    </TavernPage>
  )
}
