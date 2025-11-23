// src/app/friends/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authenticatedFetch, isAuthenticated } from '@/lib/clientAuth'

interface Friend {
  id: string
  email: string
  name: string | null
  isOnline: boolean
  lastSeenAt: string | null
}

interface FriendRequest {
  id: string
  senderId: string
  receiverId: string
  status: string
  message: string | null
  createdAt: string
  sender: Friend
  receiver: Friend
}

interface SearchResult extends Friend {
  isFriend: boolean
  friendRequest: { id: string; type: 'incoming' | 'outgoing' } | null
}

export default function FriendsPage() {
  const router = useRouter()
  const [friends, setFriends] = useState<Friend[]>([])
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([])
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [activeTab, setActiveTab] = useState<'friends' | 'requests' | 'search'>('friends')

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    loadFriends()
    loadRequests()
  }, [])

  const loadFriends = async () => {
    try {
      const response = await authenticatedFetch('/api/friends')
      if (response.ok) {
        const data = await response.json()
        setFriends(data.friends || [])
      }
    } catch (error) {
      console.error('Failed to load friends:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadRequests = async () => {
    try {
      const response = await authenticatedFetch('/api/friends/requests')
      if (response.ok) {
        const data = await response.json()
        const incoming = data.requests.filter((r: FriendRequest) => r.status === 'PENDING' && r.receiverId)
        const outgoing = data.requests.filter((r: FriendRequest) => r.status === 'PENDING' && r.senderId)
        setIncomingRequests(incoming)
        setOutgoingRequests(outgoing)
      }
    } catch (error) {
      console.error('Failed to load requests:', error)
    }
  }

  const handleSearch = async () => {
    if (searchQuery.length < 2) return

    setSearching(true)
    try {
      const response = await authenticatedFetch(`/api/friends/search?q=${encodeURIComponent(searchQuery)}`)
      if (response.ok) {
        const data = await response.json()
        setSearchResults(data.users || [])
      }
    } catch (error) {
      console.error('Failed to search users:', error)
    } finally {
      setSearching(false)
    }
  }

  const handleSendRequest = async (userId: string) => {
    try {
      const response = await authenticatedFetch('/api/friends/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverId: userId }),
      })

      if (response.ok) {
        await handleSearch() // Refresh search results
      }
    } catch (error) {
      console.error('Failed to send request:', error)
    }
  }

  const handleAcceptRequest = async (requestId: string) => {
    try {
      const response = await authenticatedFetch(`/api/friends/requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept' }),
      })

      if (response.ok) {
        await loadFriends()
        await loadRequests()
      }
    } catch (error) {
      console.error('Failed to accept request:', error)
    }
  }

  const handleRejectRequest = async (requestId: string) => {
    try {
      const response = await authenticatedFetch(`/api/friends/requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      })

      if (response.ok) {
        await loadRequests()
      }
    } catch (error) {
      console.error('Failed to reject request:', error)
    }
  }

  const handleRemoveFriend = async (friendId: string) => {
    if (!confirm('Are you sure you want to remove this friend?')) return

    try {
      const response = await authenticatedFetch(`/api/friends?friendId=${friendId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        await loadFriends()
      }
    } catch (error) {
      console.error('Failed to remove friend:', error)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-gray-800 rounded-lg shadow-2xl overflow-hidden">
          <div className="p-6 border-b border-gray-700">
            <h1 className="text-3xl font-bold text-white">Friends</h1>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-700">
            <button
              onClick={() => setActiveTab('friends')}
              className={`flex-1 py-3 px-4 font-semibold transition ${
                activeTab === 'friends'
                  ? 'bg-gray-700 text-white border-b-2 border-blue-500'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Friends ({friends.length})
            </button>
            <button
              onClick={() => setActiveTab('requests')}
              className={`flex-1 py-3 px-4 font-semibold transition relative ${
                activeTab === 'requests'
                  ? 'bg-gray-700 text-white border-b-2 border-blue-500'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Requests ({incomingRequests.length})
              {incomingRequests.length > 0 && (
                <span className="absolute top-2 right-2 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {incomingRequests.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('search')}
              className={`flex-1 py-3 px-4 font-semibold transition ${
                activeTab === 'search'
                  ? 'bg-gray-700 text-white border-b-2 border-blue-500'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Add Friends
            </button>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {activeTab === 'friends' && (
              <div className="space-y-3">
                {friends.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    No friends yet. Search for users to add!
                  </div>
                ) : (
                  friends.map((friend) => (
                    <div key={friend.id} className="bg-gray-700 rounded-lg p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`h-3 w-3 rounded-full ${friend.isOnline ? 'bg-green-500' : 'bg-gray-500'}`} />
                        <div>
                          <p className="text-white font-semibold">{friend.name || friend.email}</p>
                          <p className="text-gray-400 text-sm">
                            {friend.isOnline ? 'Online' : friend.lastSeenAt ? `Last seen ${new Date(friend.lastSeenAt).toLocaleDateString()}` : 'Offline'}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveFriend(friend.id)}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm font-semibold transition"
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'requests' && (
              <div className="space-y-6">
                {incomingRequests.length > 0 && (
                  <div>
                    <h3 className="text-white font-semibold mb-3">Incoming Requests</h3>
                    <div className="space-y-3">
                      {incomingRequests.map((request) => (
                        <div key={request.id} className="bg-gray-700 rounded-lg p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-white font-semibold">{request.sender.name || request.sender.email}</p>
                              {request.message && <p className="text-gray-400 text-sm mt-1">{request.message}</p>}
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleAcceptRequest(request.id)}
                                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm font-semibold transition"
                              >
                                Accept
                              </button>
                              <button
                                onClick={() => handleRejectRequest(request.id)}
                                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm font-semibold transition"
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {outgoingRequests.length > 0 && (
                  <div>
                    <h3 className="text-white font-semibold mb-3">Outgoing Requests</h3>
                    <div className="space-y-3">
                      {outgoingRequests.map((request) => (
                        <div key={request.id} className="bg-gray-700 rounded-lg p-4 flex items-center justify-between">
                          <p className="text-white">{request.receiver.name || request.receiver.email}</p>
                          <span className="text-yellow-400 text-sm">Pending</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {incomingRequests.length === 0 && outgoingRequests.length === 0 && (
                  <div className="text-center py-8 text-gray-400">
                    No pending friend requests
                  </div>
                )}
              </div>
            )}

            {activeTab === 'search' && (
              <div>
                <div className="flex gap-2 mb-6">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Search by email or name..."
                    className="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleSearch}
                    disabled={searching || searchQuery.length < 2}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white px-6 py-2 rounded-lg font-semibold transition"
                  >
                    {searching ? 'Searching...' : 'Search'}
                  </button>
                </div>

                <div className="space-y-3">
                  {searchResults.map((user) => (
                    <div key={user.id} className="bg-gray-700 rounded-lg p-4 flex items-center justify-between">
                      <div>
                        <p className="text-white font-semibold">{user.name || user.email}</p>
                        {user.isOnline && <span className="text-green-400 text-sm">Ï Online</span>}
                      </div>
                      {user.isFriend ? (
                        <span className="text-green-400 text-sm"> Friends</span>
                      ) : user.friendRequest ? (
                        <span className="text-yellow-400 text-sm">Pending</span>
                      ) : (
                        <button
                          onClick={() => handleSendRequest(user.id)}
                          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-semibold transition"
                        >
                          Add Friend
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
