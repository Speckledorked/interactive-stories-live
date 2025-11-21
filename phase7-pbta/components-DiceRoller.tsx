// src/components/DiceRoller.tsx
'use client'

import { useState, useEffect } from 'react'
import { PBTA_STATS, formatOutcome } from '@/lib/pbta-moves'

interface DiceRollerProps {
  campaignId: string
  sceneId?: string
  characterId: string
  characterStats?: Record<string, number>
  onRoll?: (result: any) => void
}

export function DiceRoller({
  campaignId,
  sceneId,
  characterId,
  characterStats = {},
  onRoll
}: DiceRollerProps) {
  const [isRolling, setIsRolling] = useState(false)
  const [selectedStat, setSelectedStat] = useState<string>('')
  const [customModifier, setCustomModifier] = useState(0)
  const [description, setDescription] = useState('')
  const [isSecret, setIsSecret] = useState(false)
  const [lastRoll, setLastRoll] = useState<any>(null)
  const [moves, setMoves] = useState<any>({ basic: [], custom: [] })
  const [selectedMove, setSelectedMove] = useState<string>('')

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

  const handleRoll = async () => {
    setIsRolling(true)

    try {
      // Find the selected move
      const move = [...moves.basic, ...moves.custom].find(m => m.name === selectedMove)
      
      // Determine stat from move
      let stat = selectedStat
      if (move?.rollType) {
        // Extract stat from rollType (e.g., "roll+cool" -> "cool")
        const match = move.rollType.match(/roll\+(\w+)/)
        if (match) {
          stat = match[1]
        }
      }

      const response = await fetch(`/api/campaigns/${campaignId}/rolls`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          characterId,
          sceneId,
          rollType: selectedMove ? 'move' : 'custom',
          moveId: move?.id,
          stat,
          modifier: customModifier,
          description: description || (move ? `Rolling ${move.name}` : 'Custom roll'),
          isSecret,
        }),
      })

      if (!response.ok) {
        throw new Error('Roll failed')
      }

      const data = await response.json()
      setLastRoll(data.roll)
      onRoll?.(data.roll)

      // Animate dice
      animateDice(data.roll.dice)
    } catch (error) {
      console.error('Roll error:', error)
    } finally {
      setIsRolling(false)
    }
  }

  const animateDice = (dice: number[]) => {
    // Simple dice animation placeholder
    // In a real app, you'd want fancy 3D dice or at least animated SVGs
  }

  const getStatModifier = (stat: string) => {
    return characterStats[stat] || 0
  }

  const getTotalModifier = () => {
    const statMod = selectedStat ? getStatModifier(selectedStat) : 0
    return statMod + customModifier
  }

  return (
    <div className="bg-white rounded-lg shadow p-4 space-y-4">
      <h3 className="text-lg font-semibold">Roll Dice</h3>

      {/* Move Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Move (Optional)
        </label>
        <select
          value={selectedMove}
          onChange={(e) => {
            setSelectedMove(e.target.value)
            // Auto-select stat based on move
            const move = [...moves.basic, ...moves.custom].find(m => m.name === e.target.value)
            if (move?.rollType) {
              const match = move.rollType.match(/roll\+(\w+)/)
              if (match) {
                setSelectedStat(match[1])
              }
            }
          }}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        >
          <option value="">Custom Roll</option>
          <optgroup label="Basic Moves">
            {moves.basic.map((move: any) => (
              <option key={move.name} value={move.name}>
                {move.name}
              </option>
            ))}
          </optgroup>
          {moves.custom.length > 0 && (
            <optgroup label="Custom Moves">
              {moves.custom.map((move: any) => (
                <option key={move.id} value={move.name}>
                  {move.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* Stat Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Stat Modifier
        </label>
        <div className="mt-1 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setSelectedStat('')}
            className={`px-3 py-2 rounded-md text-sm ${
              selectedStat === ''
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            None
          </button>
          {Object.entries(PBTA_STATS).map(([stat, desc]) => (
            <button
              key={stat}
              type="button"
              onClick={() => setSelectedStat(stat)}
              className={`px-3 py-2 rounded-md text-sm ${
                selectedStat === stat
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
              title={desc}
            >
              {stat.charAt(0).toUpperCase() + stat.slice(1)} 
              ({getStatModifier(stat) >= 0 ? '+' : ''}{getStatModifier(stat)})
            </button>
          ))}
        </div>
      </div>

      {/* Additional Modifier */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Additional Modifier
        </label>
        <div className="mt-1 flex space-x-2">
          <button
            type="button"
            onClick={() => setCustomModifier(customModifier - 1)}
            className="px-3 py-1 bg-gray-200 rounded-md hover:bg-gray-300"
          >
            -
          </button>
          <input
            type="number"
            value={customModifier}
            onChange={(e) => setCustomModifier(parseInt(e.target.value) || 0)}
            className="w-20 text-center rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          />
          <button
            type="button"
            onClick={() => setCustomModifier(customModifier + 1)}
            className="px-3 py-1 bg-gray-200 rounded-md hover:bg-gray-300"
          >
            +
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          For forward, ongoing, or help/interfere
        </p>
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          What are you doing?
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        />
      </div>

      {/* Secret Roll */}
      <div className="flex items-center">
        <input
          type="checkbox"
          id="secret"
          checked={isSecret}
          onChange={(e) => setIsSecret(e.target.checked)}
          className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
        />
        <label htmlFor="secret" className="ml-2 text-sm text-gray-700">
          Secret roll (only you see the result)
        </label>
      </div>

      {/* Roll Summary */}
      <div className="bg-gray-50 rounded-md p-3 text-sm">
        <p className="font-medium">Rolling 2d6{getTotalModifier() !== 0 && ` ${getTotalModifier() >= 0 ? '+' : ''}${getTotalModifier()}`}</p>
        {selectedMove && (
          <p className="text-gray-600">{selectedMove}</p>
        )}
      </div>

      {/* Roll Button */}
      <button
        onClick={handleRoll}
        disabled={isRolling}
        className="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
      >
        {isRolling ? 'Rolling...' : '🎲 Roll Dice'}
      </button>

      {/* Last Roll Result */}
      {lastRoll && (
        <div className={`rounded-md p-4 ${
          lastRoll.outcome === 'strongHit' ? 'bg-green-50 border-green-200' :
          lastRoll.outcome === 'weakHit' ? 'bg-yellow-50 border-yellow-200' :
          'bg-red-50 border-red-200'
        } border`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-lg">
                [{lastRoll.dice[0]}] [{lastRoll.dice[1]}] 
                {lastRoll.modifier !== 0 && ` ${lastRoll.modifier >= 0 ? '+' : ''}${lastRoll.modifier}`} 
                {' = '}{lastRoll.total}
              </p>
              <p className="text-sm font-medium mt-1">
                {formatOutcome(lastRoll.outcome)}
              </p>
              {lastRoll.description && (
                <p className="text-sm text-gray-600 mt-1">{lastRoll.description}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}