// src/app/campaigns/[id]/story/page.tsx
// Updated story page with Phase 7 PbtA features
'use client'

import { useEffect, useState } from 'react'
import { pusherClient } from '@/lib/pusher'
import { DiceRoller } from '@/components/DiceRoller'
import { TurnOrder } from '@/components/TurnOrder'
import { MovesReference } from '@/components/MovesReference'

export default function StoryPage({ params }: { params: { id: string } }) {
  const campaignId = params.id
  const [activeScene, setActiveScene] = useState<any>(null)
  const [characters, setCharacters] = useState<any[]>([])
  const [selectedCharacter, setSelectedCharacter] = useState<any>(null)
  const [rolls, setRolls] = useState<any[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [showDicePanel, setShowDicePanel] = useState(false)
  const [showMovesPanel, setShowMovesPanel] = useState(false)
  const [actionText, setActionText] = useState('')

  useEffect(() => {
    fetchData()
    subscribeToUpdates()

    return () => {
      pusherClient.unsubscribe(`campaign-${campaignId}`)
    }
  }, [campaignId])

  const fetchData = async () => {
    // Fetch active scene
    const sceneResponse = await fetch(`/api/campaigns/${campaignId}/scenes?status=active`)
    if (sceneResponse.ok) {
      const sceneData = await sceneResponse.json()
      if (sceneData.scenes?.length > 0) {
        setActiveScene(sceneData.scenes[0])
      }
    }

    // Fetch characters
    const charResponse = await fetch(`/api/campaigns/${campaignId}/characters`)
    if (charResponse.ok) {
      const charData = await charResponse.json()
      setCharacters(charData.characters || [])
      
      // Auto-select user's first character
      const myChar = charData.characters?.find((c: any) => c.userId === 'current-user-id')
      if (myChar) setSelectedCharacter(myChar)
    }

    // Check if admin
    const membershipResponse = await fetch(`/api/campaigns/${campaignId}`)
    if (membershipResponse.ok) {
      const data = await membershipResponse.json()
      setIsAdmin(data.membership?.role === 'admin')
    }

    // Fetch recent rolls
    if (activeScene) {
      const rollsResponse = await fetch(`/api/campaigns/${campaignId}/rolls?sceneId=${activeScene.id}&limit=10`)
      if (rollsResponse.ok) {
        const rollsData = await rollsResponse.json()
        setRolls(rollsData.rolls || [])
      }
    }
  }

  const subscribeToUpdates = () => {
    const channel = pusherClient.subscribe(`campaign-${campaignId}`)

    // Listen for new dice rolls
    channel.bind('dice:rolled', (data: any) => {
      console.log('Dice rolled:', data)
      setRolls(prev => [data, ...prev].slice(0, 10))
      showRollNotification(data)
    })

    // Listen for scene updates
    channel.bind('scene:resolved', (data: any) => {
      console.log('Scene resolved:', data)
      fetchData()
    })

    // Listen for turn order updates
    channel.bind('turnOrder:updated', (data: any) => {
      console.log('Turn order updated:', data)
    })
  }

  const showRollNotification = (rollData: any) => {
    // Create a temporary notification element
    const notification = document.createElement('div')
    notification.className = 'fixed top-4 right-4 bg-white shadow-lg rounded-lg p-4 z-50 animate-slide-in'
    
    const outcomeColor = rollData.outcome === 'strongHit' ? 'green' : 
                        rollData.outcome === 'weakHit' ? 'yellow' : 'red'
    
    notification.innerHTML = `
      <div class="flex items-center space-x-2">
        <span class="text-2xl">🎲</span>
        <div>
          <p class="font-semibold">${rollData.characterName} rolled!</p>
          <p class="text-sm">[${rollData.dice.join('] [')}] + ${rollData.modifier} = ${rollData.total}</p>
          <p class="text-xs text-${outcomeColor}-600">
            ${rollData.outcome === 'strongHit' ? 'Strong Hit!' : 
              rollData.outcome === 'weakHit' ? 'Weak Hit' : 'Miss'}
          </p>
        </div>
      </div>
    `
    document.body.appendChild(notification)
    
    setTimeout(() => {
      notification.remove()
    }, 5000)
  }

  const handleSubmitAction = async () => {
    if (!selectedCharacter || !actionText.trim()) return

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/scenes/${activeScene.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: selectedCharacter.id,
          actionText: actionText.trim()
        })
      })

      if (response.ok) {
        setActionText('')
      }
    } catch (error) {
      console.error('Failed to submit action:', error)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Main Story Area */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Scene Header */}
            {activeScene && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-2xl font-bold mb-2">
                  Scene {activeScene.sceneNumber}: {activeScene.title || 'Untitled'}
                </h2>
                {activeScene.location && (
                  <p className="text-gray-600 mb-4">📍 {activeScene.location}</p>
                )}
                <div className="prose max-w-none">
                  <p>{activeScene.framing}</p>
                </div>
                {activeScene.stakes && (
                  <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                    <p className="text-sm font-medium text-yellow-800">Stakes:</p>
                    <p className="text-sm text-yellow-700">{activeScene.stakes}</p>
                  </div>
                )}
              </div>
            )}

            {/* Turn Order */}
            {activeScene && (
              <TurnOrder
                campaignId={campaignId}
                sceneId={activeScene.id}
                isAdmin={isAdmin}
                currentCharacterId={selectedCharacter?.id}
              />
            )}

            {/* Recent Rolls Feed */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Recent Rolls</h3>
              <div className="space-y-3">
                {rolls.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No rolls yet in this scene</p>
                ) : (
                  rolls.map((roll: any, index: number) => (
                    <div 
                      key={roll.id || index}
                      className={`p-3 rounded-lg border ${
                        roll.outcome === 'strongHit' ? 'bg-green-50 border-green-200' :
                        roll.outcome === 'weakHit' ? 'bg-yellow-50 border-yellow-200' :
                        'bg-red-50 border-red-200'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium">
                            {roll.character?.name || 'Unknown'} 
                            {roll.move && ` - ${roll.move.name}`}
                          </p>
                          <p className="text-sm">
                            🎲 [{roll.dice[0]}] [{roll.dice[1]}] 
                            {roll.modifier !== 0 && ` ${roll.modifier >= 0 ? '+' : ''}${roll.modifier}`}
                            {' = '}<strong>{roll.total}</strong>
                          </p>
                          {roll.description && (
                            <p className="text-sm text-gray-600 mt-1">{roll.description}</p>
                          )}
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${
                          roll.outcome === 'strongHit' ? 'bg-green-600 text-white' :
                          roll.outcome === 'weakHit' ? 'bg-yellow-600 text-white' :
                          'bg-red-600 text-white'
                        }`}>
                          {roll.outcome === 'strongHit' ? '10+' : 
                           roll.outcome === 'weakHit' ? '7-9' : '6-'}
                        </span>
                      </div>
                      {roll.isSecret && (
                        <span className="text-xs text-purple-600 mt-1">🤫 Secret Roll</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Actions Area */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Actions</h3>
              <div className="space-y-4">
                <textarea
                  value={actionText}
                  onChange={(e) => setActionText(e.target.value)}
                  placeholder="What does your character do?"
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                  rows={3}
                />
                <div className="flex space-x-3">
                  <button 
                    onClick={handleSubmitAction}
                    disabled={!selectedCharacter || !actionText.trim()}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Submit Action
                  </button>
                  <button 
                    onClick={() => setShowDicePanel(!showDicePanel)}
                    className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
                  >
                    🎲 Roll Dice
                  </button>
                  <button 
                    onClick={() => setShowMovesPanel(!showMovesPanel)}
                    className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                  >
                    📖 Moves
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            
            {/* Character Info */}
            {selectedCharacter && (
              <div className="bg-white rounded-lg shadow p-4">
                <h3 className="text-lg font-semibold mb-3">{selectedCharacter.name}</h3>
                <div className="space-y-2 text-sm">
                  {selectedCharacter.stats && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(selectedCharacter.stats as Record<string, number>).map(([stat, value]) => (
                          <div key={stat} className="flex justify-between">
                            <span className="capitalize">{stat}:</span>
                            <span className="font-medium">{value >= 0 ? '+' : ''}{value}</span>
                          </div>
                        ))}
                      </div>
                      <div className="border-t pt-2">
                        <div className="flex justify-between">
                          <span>Harm:</span>
                          <span>{selectedCharacter.harm || 0}/6</span>
                        </div>
                        <div className="flex justify-between">
                          <span>XP:</span>
                          <span>{selectedCharacter.experience || 0}/5</span>
                        </div>
                      </div>
                    </>
                  )}
                  {selectedCharacter.conditions?.length > 0 && (
                    <div className="border-t pt-2">
                      <p className="font-medium">Conditions:</p>
                      <div className="flex flex-wrap gap-1">
                        {selectedCharacter.conditions.map((condition: string) => (
                          <span key={condition} className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">
                            {condition}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Dice Roller Panel */}
            {showDicePanel && selectedCharacter && (
              <DiceRoller
                campaignId={campaignId}
                sceneId={activeScene?.id}
                characterId={selectedCharacter.id}
                characterStats={selectedCharacter.stats}
                onRoll={(result) => {
                  console.log('Roll result:', result)
                }}
              />
            )}

            {/* Quick Stats */}
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="text-lg font-semibold mb-3">Scene Info</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Round:</span>
                  <span className="font-medium">1</span>
                </div>
                <div className="flex justify-between">
                  <span>Players:</span>
                  <span className="font-medium">{characters.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Scene Type:</span>
                  <span className="font-medium">{activeScene?.sceneType || 'Dramatic'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Moves Reference Panel */}
        {showMovesPanel && (
          <div className="mt-6">
            <MovesReference campaignId={campaignId} isAdmin={isAdmin} />
          </div>
        )}
      </div>
    </div>
  )
}