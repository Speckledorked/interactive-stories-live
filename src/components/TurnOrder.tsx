// src/components/TurnOrder.tsx
'use client'

import { useState, useEffect } from 'react'
import { authenticatedFetch } from '@/lib/clientAuth'

interface TurnOrderEntry {
  characterId: string
  characterName: string
  initiative: number
  hasActed: boolean
}

interface TurnOrderProps {
  campaignId: string
  sceneId: string
  isAdmin: boolean
  currentCharacterId?: string
}

export function TurnOrder({
  campaignId,
  sceneId,
  isAdmin,
  currentCharacterId
}: TurnOrderProps) {
  const [turnOrder, setTurnOrder] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTurnOrder()

    // Poll for updates every 5 seconds (fallback if Pusher not set up)
    const interval = setInterval(() => {
      fetchTurnOrder()
    }, 5000)

    return () => {
      clearInterval(interval)
    }
  }, [sceneId])

  const fetchTurnOrder = async () => {
    try {
      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/scenes/${sceneId}/turn-order`
      )
      if (response.ok) {
        const data = await response.json()
        setTurnOrder(data.turnOrder)
      }
    } catch (error) {
      console.error('Failed to fetch turn order:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleInitialize = async () => {
    try {
      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/scenes/${sceneId}/turn-order`,
        {
          method: 'POST',
        }
      )
      if (response.ok) {
        const data = await response.json()
        setTurnOrder(data.turnOrder)
      }
    } catch (error) {
      console.error('Failed to initialize turn order:', error)
    }
  }

  const handleNextTurn = async () => {
    try {
      await authenticatedFetch(
        `/api/campaigns/${campaignId}/scenes/${sceneId}/turn-order`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'next' }),
        }
      )
      // Refresh immediately after action
      fetchTurnOrder()
    } catch (error) {
      console.error('Failed to advance turn:', error)
    }
  }

  const handleEndMyTurn = async () => {
    if (!currentCharacterId) return

    try {
      await authenticatedFetch(
        `/api/campaigns/${campaignId}/scenes/${sceneId}/turn-order`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'endTurn',
            characterId: currentCharacterId
          }),
        }
      )
      // Refresh immediately after action
      fetchTurnOrder()
    } catch (error) {
      console.error('Failed to end turn:', error)
    }
  }

  const handleEndCombat = async () => {
    try {
      await authenticatedFetch(
        `/api/campaigns/${campaignId}/scenes/${sceneId}/turn-order`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'end' }),
        }
      )
      setTurnOrder(null)
    } catch (error) {
      console.error('Failed to end combat:', error)
    }
  }

  if (loading) {
    return <div className="animate-pulse bg-gray-900 h-32 rounded-lg border border-gray-800"></div>
  }

  if (!turnOrder || !turnOrder.isActive) {
    if (!isAdmin) return null

    return (
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Turn Order</h3>
          <button
            onClick={handleInitialize}
            className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 font-medium"
          >
            Start Combat
          </button>
        </div>
      </div>
    )
  }

  const order = turnOrder.order as TurnOrderEntry[]
  const currentCharacter = order[turnOrder.currentTurn]
  const isMyTurn = currentCharacter?.characterId === currentCharacterId

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
      <div className="px-4 py-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Turn Order</h3>
            <p className="text-sm text-gray-400">
              Round {turnOrder.roundNumber}
            </p>
          </div>
          {isAdmin && (
            <div className="flex space-x-2">
              <button
                onClick={handleNextTurn}
                className="px-3 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium"
              >
                Next Turn
              </button>
              <button
                onClick={handleEndCombat}
                className="px-3 py-1 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm font-medium"
              >
                End Combat
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="p-4">
        {/* Current Turn Highlight */}
        {currentCharacter && (
          <div className="mb-4 p-3 bg-primary-900/20 border-2 border-primary-500 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-primary-400 font-medium">Current Turn</p>
                <p className="text-lg font-bold text-white">{currentCharacter.characterName}</p>
              </div>
              {isMyTurn && !currentCharacter.hasActed && (
                <button
                  onClick={handleEndMyTurn}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 font-medium"
                >
                  End My Turn
                </button>
              )}
            </div>
          </div>
        )}

        {/* Turn Order List */}
        <div className="space-y-2">
          {order.map((entry, index) => {
            const isCurrent = index === turnOrder.currentTurn
            const isMe = entry.characterId === currentCharacterId

            return (
              <div
                key={entry.characterId}
                className={`px-3 py-2 rounded-lg flex items-center justify-between ${
                  isCurrent
                    ? 'bg-primary-900/30 border-2 border-primary-500'
                    : entry.hasActed
                    ? 'bg-gray-800/50 text-gray-500'
                    : 'bg-gray-800 border border-gray-700'
                } ${isMe ? 'ring-2 ring-blue-500' : ''}`}
              >
                <div className="flex items-center space-x-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      isCurrent
                        ? 'bg-primary-600 text-white'
                        : entry.hasActed
                        ? 'bg-gray-600 text-gray-400'
                        : 'bg-gray-700 text-white'
                    }`}
                  >
                    {index + 1}
                  </div>
                  <div>
                    <p className={`font-medium text-white ${entry.hasActed ? 'line-through text-gray-500' : ''}`}>
                      {entry.characterName}
                      {isMe && ' (You)'}
                    </p>
                    <p className="text-xs text-gray-500">
                      Initiative: {entry.initiative}
                    </p>
                  </div>
                </div>
                {entry.hasActed && (
                  <span className="text-xs bg-gray-700 text-gray-400 px-2 py-1 rounded">
                    Acted
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
