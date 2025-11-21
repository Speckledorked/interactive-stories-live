// src/components/TurnOrder.tsx
'use client'

import { useState, useEffect } from 'react'
import { pusherClient } from '@/lib/pusher'

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
    subscribeToUpdates()

    return () => {
      pusherClient.unsubscribe(`campaign-${campaignId}`)
    }
  }, [sceneId])

  const fetchTurnOrder = async () => {
    try {
      const response = await fetch(
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

  const subscribeToUpdates = () => {
    const channel = pusherClient.subscribe(`campaign-${campaignId}`)

    channel.bind('turnOrder:initialized', (data: any) => {
      if (data.sceneId === sceneId) {
        fetchTurnOrder()
      }
    })

    channel.bind('turnOrder:updated', (data: any) => {
      if (data.sceneId === sceneId) {
        setTurnOrder((prev: any) => ({
          ...prev,
          order: data.order,
          currentTurn: data.currentTurn,
          roundNumber: data.roundNumber,
        }))
      }
    })

    channel.bind('turnOrder:ended', (data: any) => {
      if (data.sceneId === sceneId) {
        setTurnOrder(null)
      }
    })
  }

  const handleInitialize = async () => {
    try {
      const response = await fetch(
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
      await fetch(
        `/api/campaigns/${campaignId}/scenes/${sceneId}/turn-order`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'next' }),
        }
      )
    } catch (error) {
      console.error('Failed to advance turn:', error)
    }
  }

  const handleEndMyTurn = async () => {
    if (!currentCharacterId) return

    try {
      await fetch(
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
    } catch (error) {
      console.error('Failed to end turn:', error)
    }
  }

  const handleEndCombat = async () => {
    try {
      await fetch(
        `/api/campaigns/${campaignId}/scenes/${sceneId}/turn-order`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'end' }),
        }
      )
    } catch (error) {
      console.error('Failed to end combat:', error)
    }
  }

  if (loading) {
    return <div className="animate-pulse bg-gray-200 h-32 rounded-lg"></div>
  }

  if (!turnOrder || !turnOrder.isActive) {
    if (!isAdmin) return null

    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Turn Order</h3>
          <button
            onClick={handleInitialize}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
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
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Turn Order</h3>
            <p className="text-sm text-gray-600">
              Round {turnOrder.roundNumber}
            </p>
          </div>
          {isAdmin && (
            <div className="flex space-x-2">
              <button
                onClick={handleNextTurn}
                className="px-3 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm"
              >
                Next Turn
              </button>
              <button
                onClick={handleEndCombat}
                className="px-3 py-1 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
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
          <div className="mb-4 p-3 bg-indigo-50 border-2 border-indigo-300 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-indigo-600 font-medium">Current Turn</p>
                <p className="text-lg font-bold">{currentCharacter.characterName}</p>
              </div>
              {isMyTurn && !currentCharacter.hasActed && (
                <button
                  onClick={handleEndMyTurn}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
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
                    ? 'bg-indigo-100 border-2 border-indigo-300'
                    : entry.hasActed
                    ? 'bg-gray-100 text-gray-500'
                    : 'bg-white border border-gray-200'
                } ${isMe ? 'ring-2 ring-blue-400' : ''}`}
              >
                <div className="flex items-center space-x-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      isCurrent
                        ? 'bg-indigo-600 text-white'
                        : entry.hasActed
                        ? 'bg-gray-400 text-white'
                        : 'bg-gray-600 text-white'
                    }`}
                  >
                    {index + 1}
                  </div>
                  <div>
                    <p className={`font-medium ${entry.hasActed ? 'line-through' : ''}`}>
                      {entry.characterName}
                      {isMe && ' (You)'}
                    </p>
                    <p className="text-xs text-gray-500">
                      Initiative: {entry.initiative}
                    </p>
                  </div>
                </div>
                {entry.hasActed && (
                  <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded">
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