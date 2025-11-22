// src/components/character/CharacterSnapshotModal.tsx
// Quick character state reference modal for use during story scenes

'use client'

import { useEffect, useState } from 'react'
import HarmTracker from './HarmTracker'
import StatBar from './StatBar'
import CharacterAvatar from './CharacterAvatar'
import ConsequenceBadge from './ConsequenceBadge'

interface CharacterSnapshotModalProps {
  characterId: string
  campaignId: string
  isOpen: boolean
  onClose: () => void
}

interface CharacterData {
  id: string
  name: string
  pronouns?: string
  concept?: string
  description?: string
  appearance?: string
  personality?: string
  currentLocation?: string
  harm: number
  stats?: any
  conditions?: any
  inventory?: any
  equipment?: any
  resources?: any
  perks?: any
  consequences?: any
  relationships?: any
  moves?: string[]
}

export default function CharacterSnapshotModal({
  characterId,
  campaignId,
  isOpen,
  onClose
}: CharacterSnapshotModalProps) {
  const [character, setCharacter] = useState<CharacterData | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'stats' | 'inventory' | 'relationships'>('stats')

  useEffect(() => {
    if (isOpen && characterId) {
      loadCharacter()
    }
  }, [isOpen, characterId])

  const loadCharacter = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/characters/${characterId}`)
      if (response.ok) {
        const data = await response.json()
        setCharacter(data)
      }
    } catch (error) {
      console.error('Failed to load character:', error)
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  // Close on background click
  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Parse stats
  const stats = character?.stats as Record<string, number> || {}
  const statEntries = Object.entries(stats)

  // Parse consequences
  const consequences = character?.consequences as any || {}
  const allConsequences = [
    ...(consequences.promises || []).map((p: string) => ({ type: 'promise' as const, description: p })),
    ...(consequences.debts || []).map((d: string) => ({ type: 'debt' as const, description: d })),
    ...(consequences.enemies || []).map((e: string) => ({ type: 'enemy' as const, description: e })),
    ...(consequences.longTermThreats || []).map((t: string) => ({ type: 'longTermThreat' as const, description: t }))
  ]

  // Parse inventory
  const inventory = character?.inventory as any || {}
  const items = inventory.items || []

  // Parse equipment
  const equipment = character?.equipment as any || {}

  // Parse resources
  const resources = character?.resources as any || {}

  // Parse perks
  const perks = character?.perks as any || []
  const perksList = Array.isArray(perks) ? perks : []

  // Parse conditions
  const conditions = character?.conditions as any || {}
  const conditionsList = conditions.conditions || []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={handleBackgroundClick}
    >
      <div className="bg-gray-900 rounded-lg border border-gray-700 shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-700 bg-gradient-to-r from-primary-900/20 to-primary-800/10">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 flex-1">
              {character && <CharacterAvatar name={character.name} size="md" />}
              <div>
                <h2 className="text-xl font-bold text-white">
                  {character?.name || 'Loading...'}
                </h2>
                {character?.pronouns && (
                  <p className="text-sm text-gray-400">{character.pronouns}</p>
                )}
                {character?.concept && (
                  <p className="text-sm text-gray-300 italic">{character.concept}</p>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors text-xl"
            >
              ✕
            </button>
          </div>

          {/* Quick Info */}
          {character && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {character.currentLocation && (
                <div className="text-xs">
                  <span className="text-gray-500">Location: </span>
                  <span className="text-gray-300">{character.currentLocation}</span>
                </div>
              )}
              <div className="text-xs">
                <span className="text-gray-500">Harm: </span>
                <span className={`font-semibold ${character.harm >= 4 ? 'text-red-400' : character.harm >= 2 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {character.harm}/6
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center p-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
            </div>
          ) : character ? (
            <>
              {/* Tabs */}
              <div className="flex border-b border-gray-700 bg-gray-800/50 sticky top-0 z-10">
                {[
                  { key: 'stats', label: 'Stats & Status', icon: '📊' },
                  { key: 'inventory', label: 'Inventory', icon: '🎒' },
                  { key: 'relationships', label: 'Relationships', icon: '💕' }
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key as any)}
                    className={`flex-1 py-3 px-4 text-sm font-medium transition-colors border-b-2 ${
                      activeTab === tab.key
                        ? 'border-primary-500 text-primary-400 bg-primary-900/20'
                        : 'border-transparent text-gray-400 hover:text-gray-300 hover:bg-gray-800/50'
                    }`}
                  >
                    <span className="mr-1">{tab.icon}</span>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="p-4">
                {activeTab === 'stats' && (
                  <div className="space-y-4">
                    {/* Harm Tracker */}
                    <div>
                      <h3 className="text-sm font-semibold text-gray-400 mb-2">HARM</h3>
                      <HarmTracker current={character.harm} max={6} />
                    </div>

                    {/* Stats */}
                    {statEntries.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-400 mb-2">STATS</h3>
                        <div className="space-y-2">
                          {statEntries.map(([stat, value]) => (
                            <StatBar key={stat} name={stat} value={value as number} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Conditions */}
                    {conditionsList.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-400 mb-2">CONDITIONS</h3>
                        <div className="flex flex-wrap gap-2">
                          {conditionsList.map((cond: any, idx: number) => (
                            <span
                              key={idx}
                              className="px-3 py-1 bg-red-500/20 text-red-400 rounded-full text-xs font-medium border border-red-500/50"
                            >
                              {typeof cond === 'string' ? cond : cond.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Perks */}
                    {perksList.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-400 mb-2">PERKS & ABILITIES</h3>
                        <div className="space-y-2">
                          {perksList.slice(0, 5).map((perk: any, idx: number) => (
                            <div key={idx} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
                              <div className="font-medium text-primary-400 text-sm">
                                {perk.name || perk}
                              </div>
                              {perk.description && (
                                <p className="text-xs text-gray-400 mt-1">{perk.description}</p>
                              )}
                            </div>
                          ))}
                          {perksList.length > 5 && (
                            <p className="text-xs text-gray-500 italic">
                              +{perksList.length - 5} more...
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Consequences */}
                    {allConsequences.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-400 mb-2">CONSEQUENCES</h3>
                        <div className="space-y-2">
                          {allConsequences.map((cons, idx) => (
                            <ConsequenceBadge key={idx} type={cons.type} description={cons.description} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'inventory' && (
                  <div className="space-y-4">
                    {/* Equipment */}
                    {(equipment.weapon || equipment.armor || equipment.misc) && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-400 mb-2">EQUIPPED</h3>
                        <div className="space-y-2">
                          {equipment.weapon && (
                            <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
                              <span className="text-xs text-gray-500">Weapon:</span>
                              <p className="text-white font-medium">
                                {typeof equipment.weapon === 'string' ? equipment.weapon : equipment.weapon.name}
                              </p>
                            </div>
                          )}
                          {equipment.armor && (
                            <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
                              <span className="text-xs text-gray-500">Armor:</span>
                              <p className="text-white font-medium">
                                {typeof equipment.armor === 'string' ? equipment.armor : equipment.armor.name}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Inventory Items */}
                    {items.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-400 mb-2">INVENTORY</h3>
                        <div className="grid grid-cols-2 gap-2">
                          {items.map((item: any, idx: number) => (
                            <div key={idx} className="bg-gray-800/50 rounded-lg p-2 border border-gray-700">
                              <div className="text-sm text-white font-medium">
                                {typeof item === 'string' ? item : item.name}
                              </div>
                              {item.quantity && (
                                <div className="text-xs text-gray-500">×{item.quantity}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Resources */}
                    {(resources.gold !== undefined || resources.contacts?.length > 0) && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-400 mb-2">RESOURCES</h3>
                        <div className="space-y-2">
                          {resources.gold !== undefined && (
                            <div className="flex items-center justify-between bg-gray-800/50 rounded-lg p-3 border border-gray-700">
                              <span className="text-gray-400">Gold</span>
                              <span className="text-yellow-400 font-bold">{resources.gold}</span>
                            </div>
                          )}
                          {resources.contacts && resources.contacts.length > 0 && (
                            <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
                              <span className="text-xs text-gray-500 block mb-1">Contacts:</span>
                              <div className="flex flex-wrap gap-1">
                                {resources.contacts.map((contact: string, idx: number) => (
                                  <span key={idx} className="text-xs bg-blue-900/30 text-blue-400 px-2 py-1 rounded">
                                    {contact}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'relationships' && (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-400 italic">
                      Your character's relationships with NPCs and factions. These develop organically through your actions.
                    </p>

                    {allConsequences.filter(c => c.type === 'enemy').length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-red-400 mb-2">⚔️ ENEMIES</h3>
                        <div className="space-y-2">
                          {allConsequences
                            .filter(c => c.type === 'enemy')
                            .map((cons, idx) => (
                              <div key={idx} className="bg-red-900/20 rounded-lg p-3 border border-red-700/50">
                                <p className="text-sm text-red-300">{cons.description}</p>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {allConsequences.filter(c => c.type === 'promise').length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-blue-400 mb-2">🤝 PROMISES</h3>
                        <div className="space-y-2">
                          {allConsequences
                            .filter(c => c.type === 'promise')
                            .map((cons, idx) => (
                              <div key={idx} className="bg-blue-900/20 rounded-lg p-3 border border-blue-700/50">
                                <p className="text-sm text-blue-300">{cons.description}</p>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {allConsequences.filter(c => c.type === 'debt').length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-yellow-400 mb-2">💰 DEBTS</h3>
                        <div className="space-y-2">
                          {allConsequences
                            .filter(c => c.type === 'debt')
                            .map((cons, idx) => (
                              <div key={idx} className="bg-yellow-900/20 rounded-lg p-3 border border-yellow-700/50">
                                <p className="text-sm text-yellow-300">{cons.description}</p>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {allConsequences.length === 0 && (
                      <div className="text-center py-8 text-gray-500">
                        <div className="text-4xl mb-2">🌟</div>
                        <p className="text-sm">No significant relationships yet</p>
                        <p className="text-xs mt-1">Your actions will shape these over time</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <p>Character not found</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 bg-gray-800/50">
          <div className="flex items-center justify-between">
            <button
              onClick={onClose}
              className="btn-secondary"
            >
              Close
            </button>
            <a
              href={`/campaigns/${campaignId}/characters/${characterId}`}
              className="btn-primary text-sm"
              target="_blank"
            >
              Full Character Sheet →
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
