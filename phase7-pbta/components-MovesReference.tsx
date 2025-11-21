// src/components/MovesReference.tsx
'use client'

import { useState, useEffect } from 'react'

interface Move {
  id?: string
  name: string
  trigger: string
  description: string
  rollType?: string
  outcomes: {
    strongHit?: string
    weakHit?: string
    miss?: string
  }
  category: string
}

interface MovesReferenceProps {
  campaignId: string
  isAdmin: boolean
}

export function MovesReference({ campaignId, isAdmin }: MovesReferenceProps) {
  const [moves, setMoves] = useState<any>({ basic: [], peripheral: [], custom: [] })
  const [showModal, setShowModal] = useState(false)
  const [selectedMove, setSelectedMove] = useState<Move | null>(null)
  const [creatingMove, setCreatingMove] = useState(false)
  const [newMove, setNewMove] = useState<Partial<Move>>({
    name: '',
    trigger: '',
    description: '',
    rollType: '',
    outcomes: {},
    category: 'custom'
  })

  useEffect(() => {
    fetchMoves()
  }, [campaignId])

  const fetchMoves = async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/moves`)
      if (response.ok) {
        const data = await response.json()
        setMoves(data.moves)
      }
    } catch (error) {
      console.error('Failed to fetch moves:', error)
    }
  }

  const handleInitializeMoves = async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/moves`, {
        method: 'PUT',
      })
      if (response.ok) {
        await fetchMoves()
      }
    } catch (error) {
      console.error('Failed to initialize moves:', error)
    }
  }

  const handleCreateMove = async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/moves`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMove),
      })
      if (response.ok) {
        await fetchMoves()
        setCreatingMove(false)
        setNewMove({
          name: '',
          trigger: '',
          description: '',
          rollType: '',
          outcomes: {},
          category: 'custom'
        })
      }
    } catch (error) {
      console.error('Failed to create move:', error)
    }
  }

  const MoveCard = ({ move }: { move: Move }) => (
    <div
      className="bg-white border rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => {
        setSelectedMove(move)
        setShowModal(true)
      }}
    >
      <h4 className="font-semibold text-sm">{move.name}</h4>
      <p className="text-xs text-gray-600 mt-1 line-clamp-2">{move.trigger}</p>
      {move.rollType && (
        <span className="inline-block mt-2 px-2 py-1 bg-indigo-100 text-indigo-700 text-xs rounded">
          {move.rollType}
        </span>
      )}
    </div>
  )

  const allMovesExist = moves.basic.length > 0

  return (
    <>
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Moves Reference</h3>
          {isAdmin && (
            <div className="flex space-x-2">
              {!allMovesExist && (
                <button
                  onClick={handleInitializeMoves}
                  className="px-3 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm"
                >
                  Initialize PbtA Moves
                </button>
              )}
              <button
                onClick={() => setCreatingMove(true)}
                className="px-3 py-1 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm"
              >
                + Custom Move
              </button>
            </div>
          )}
        </div>

        {/* Basic Moves */}
        {moves.basic.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Basic Moves</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {moves.basic.map((move: Move) => (
                <MoveCard key={move.name} move={move} />
              ))}
            </div>
          </div>
        )}

        {/* Peripheral Moves */}
        {moves.peripheral.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Peripheral Moves</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {moves.peripheral.map((move: Move) => (
                <MoveCard key={move.name} move={move} />
              ))}
            </div>
          </div>
        )}

        {/* Custom Moves */}
        {moves.custom.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Custom Moves</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {moves.custom.map((move: Move) => (
                <MoveCard key={move.id || move.name} move={move} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Move Detail Modal */}
      {showModal && selectedMove && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-2xl font-bold">{selectedMove.name}</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-gray-700">Trigger</h3>
                <p className="text-gray-600">{selectedMove.trigger}</p>
              </div>

              <div>
                <h3 className="font-semibold text-gray-700">Description</h3>
                <p className="text-gray-600">{selectedMove.description}</p>
              </div>

              {selectedMove.rollType && (
                <div>
                  <h3 className="font-semibold text-gray-700">Roll</h3>
                  <p className="text-gray-600">{selectedMove.rollType}</p>
                </div>
              )}

              {Object.keys(selectedMove.outcomes).length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-700">Outcomes</h3>
                  <div className="space-y-2 mt-2">
                    {selectedMove.outcomes.strongHit && (
                      <div className="pl-4 border-l-4 border-green-400">
                        <p className="font-medium text-green-700">Strong Hit (10+)</p>
                        <p className="text-gray-600">{selectedMove.outcomes.strongHit}</p>
                      </div>
                    )}
                    {selectedMove.outcomes.weakHit && (
                      <div className="pl-4 border-l-4 border-yellow-400">
                        <p className="font-medium text-yellow-700">Weak Hit (7-9)</p>
                        <p className="text-gray-600">{selectedMove.outcomes.weakHit}</p>
                      </div>
                    )}
                    {selectedMove.outcomes.miss && (
                      <div className="pl-4 border-l-4 border-red-400">
                        <p className="font-medium text-red-700">Miss (6-)</p>
                        <p className="text-gray-600">{selectedMove.outcomes.miss}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Move Modal */}
      {creatingMove && isAdmin && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6">
            <h2 className="text-2xl font-bold mb-4">Create Custom Move</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={newMove.name}
                  onChange={(e) => setNewMove({ ...newMove, name: e.target.value })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Trigger</label>
                <input
                  type="text"
                  value={newMove.trigger}
                  onChange={(e) => setNewMove({ ...newMove, trigger: e.target.value })}
                  placeholder="When you..."
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  value={newMove.description}
                  onChange={(e) => setNewMove({ ...newMove, description: e.target.value })}
                  rows={3}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Roll Type</label>
                <input
                  type="text"
                  value={newMove.rollType}
                  onChange={(e) => setNewMove({ ...newMove, rollType: e.target.value })}
                  placeholder="e.g., roll+cool"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Outcomes</label>
                <div className="space-y-2 mt-2">
                  <input
                    type="text"
                    placeholder="Strong Hit (10+)"
                    onChange={(e) => setNewMove({
                      ...newMove,
                      outcomes: { ...newMove.outcomes, strongHit: e.target.value }
                    })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Weak Hit (7-9)"
                    onChange={(e) => setNewMove({
                      ...newMove,
                      outcomes: { ...newMove.outcomes, weakHit: e.target.value }
                    })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Miss (6-)"
                    onChange={(e) => setNewMove({
                      ...newMove,
                      outcomes: { ...newMove.outcomes, miss: e.target.value }
                    })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => setCreatingMove(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateMove}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
              >
                Create Move
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}