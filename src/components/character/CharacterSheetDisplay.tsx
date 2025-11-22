// src/components/character/CharacterSheetDisplay.tsx
// Full character sheet display for dedicated character page

'use client'

import { useState } from 'react'
import HarmTracker from './HarmTracker'
import StatBar from './StatBar'
import CharacterAvatar from './CharacterAvatar'
import ConsequenceBadge from './ConsequenceBadge'

interface CharacterSheetDisplayProps {
  character: any
}

export default function CharacterSheetDisplay({ character }: CharacterSheetDisplayProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'stats' | 'inventory' | 'relationships'>('overview')

  if (!character) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>Character not found</p>
      </div>
    )
  }

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

  // Parse moves
  const moves = character?.moves || []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-900/30 via-purple-900/20 to-magenta-900/30 rounded-xl p-6 border border-indigo-500/20">
        <div className="flex items-start gap-4">
          <CharacterAvatar name={character.name} size="lg" />
          <div className="flex-1">
            <h2 className="text-3xl font-bold text-white mb-1">
              {character.name}
            </h2>
            {character.pronouns && (
              <p className="text-sm text-gray-400 mb-2">{character.pronouns}</p>
            )}
            {character.concept && (
              <p className="text-lg text-indigo-300 italic mb-3">{character.concept}</p>
            )}

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              {character.currentLocation && (
                <div className="bg-black/20 rounded-lg p-3 border border-white/10">
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Location</div>
                  <div className="text-sm text-white font-medium">{character.currentLocation}</div>
                </div>
              )}
              <div className="bg-black/20 rounded-lg p-3 border border-white/10">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Harm</div>
                <div className={`text-lg font-bold ${character.harm >= 4 ? 'text-red-400' : character.harm >= 2 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {character.harm}/6
                </div>
              </div>
              {character.xp !== undefined && (
                <div className="bg-black/20 rounded-lg p-3 border border-white/10">
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">XP</div>
                  <div className="text-lg font-bold text-blue-400">{character.xp}</div>
                </div>
              )}
              {statEntries.length > 0 && (
                <div className="bg-black/20 rounded-lg p-3 border border-white/10">
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Stats</div>
                  <div className="text-lg font-bold text-purple-400">{statEntries.length}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 border-b border-gray-700 pb-2">
        {[
          { key: 'overview', label: 'Overview', icon: '📋' },
          { key: 'stats', label: 'Stats & Status', icon: '📊' },
          { key: 'inventory', label: 'Inventory', icon: '🎒' },
          { key: 'relationships', label: 'Relationships', icon: '💕' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/50'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            <span className="mr-2">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {activeTab === 'overview' && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Description */}
            {character.description && (
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Description</h3>
                <p className="text-gray-300 leading-relaxed">{character.description}</p>
              </div>
            )}

            {/* Appearance */}
            {character.appearance && (
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Appearance</h3>
                <p className="text-gray-300 leading-relaxed">{character.appearance}</p>
              </div>
            )}

            {/* Personality */}
            {character.personality && (
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Personality</h3>
                <p className="text-gray-300 leading-relaxed">{character.personality}</p>
              </div>
            )}

            {/* Backstory */}
            {character.backstory && (
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Backstory</h3>
                <p className="text-gray-300 leading-relaxed">{character.backstory}</p>
              </div>
            )}

            {/* Goals */}
            {character.goals && (
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Goals</h3>
                <p className="text-gray-300 leading-relaxed">{character.goals}</p>
              </div>
            )}

            {/* Moves */}
            {moves.length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Moves</h3>
                <div className="space-y-2">
                  {moves.map((move: string, idx: number) => (
                    <div key={idx} className="bg-indigo-900/20 rounded-lg p-3 border border-indigo-700/30">
                      <div className="text-sm text-indigo-300 font-medium">{move}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Harm Tracker */}
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Harm</h3>
              <HarmTracker current={character.harm} max={6} />
            </div>

            {/* Stats */}
            {statEntries.length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Stats</h3>
                <div className="space-y-3">
                  {statEntries.map(([stat, value]) => (
                    <StatBar key={stat} name={stat} value={value as number} />
                  ))}
                </div>
              </div>
            )}

            {/* Conditions */}
            {conditionsList.length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Conditions</h3>
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
              <div className="card md:col-span-2">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Perks & Abilities</h3>
                <div className="grid md:grid-cols-2 gap-3">
                  {perksList.map((perk: any, idx: number) => (
                    <div key={idx} className="bg-gradient-to-r from-indigo-900/20 to-purple-900/20 rounded-lg p-4 border border-indigo-700/30">
                      <div className="font-medium text-indigo-300 mb-1">
                        {perk.name || perk}
                      </div>
                      {perk.description && (
                        <p className="text-xs text-gray-400">{perk.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Consequences */}
            {allConsequences.length > 0 && (
              <div className="card md:col-span-2">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Consequences</h3>
                <div className="grid md:grid-cols-2 gap-3">
                  {allConsequences.map((cons, idx) => (
                    <ConsequenceBadge key={idx} type={cons.type} description={cons.description} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'inventory' && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Equipment */}
            {(equipment.weapon || equipment.armor || equipment.misc) && (
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Equipped</h3>
                <div className="space-y-3">
                  {equipment.weapon && (
                    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
                      <span className="text-xs text-gray-500 block mb-1">Weapon</span>
                      <p className="text-white font-medium">
                        {typeof equipment.weapon === 'string' ? equipment.weapon : equipment.weapon.name}
                      </p>
                      {equipment.weapon.description && (
                        <p className="text-xs text-gray-400 mt-1">{equipment.weapon.description}</p>
                      )}
                    </div>
                  )}
                  {equipment.armor && (
                    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
                      <span className="text-xs text-gray-500 block mb-1">Armor</span>
                      <p className="text-white font-medium">
                        {typeof equipment.armor === 'string' ? equipment.armor : equipment.armor.name}
                      </p>
                      {equipment.armor.description && (
                        <p className="text-xs text-gray-400 mt-1">{equipment.armor.description}</p>
                      )}
                    </div>
                  )}
                  {equipment.misc && (
                    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
                      <span className="text-xs text-gray-500 block mb-1">Misc</span>
                      <p className="text-white font-medium">
                        {typeof equipment.misc === 'string' ? equipment.misc : equipment.misc.name}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Inventory Items */}
            {items.length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Inventory</h3>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((item: any, idx: number) => (
                    <div key={idx} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 hover:border-indigo-500/50 transition-colors">
                      <div className="text-sm text-white font-medium">
                        {typeof item === 'string' ? item : item.name}
                      </div>
                      {item.quantity && (
                        <div className="text-xs text-gray-500">×{item.quantity}</div>
                      )}
                      {item.description && (
                        <div className="text-xs text-gray-400 mt-1">{item.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Resources */}
            {(resources.gold !== undefined || resources.contacts?.length > 0 || Object.keys(resources).length > 0) && (
              <div className="card md:col-span-2">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Resources</h3>
                <div className="grid md:grid-cols-3 gap-3">
                  {resources.gold !== undefined && (
                    <div className="bg-gradient-to-r from-yellow-900/20 to-yellow-800/20 rounded-lg p-4 border border-yellow-700/30">
                      <span className="text-gray-400 text-sm block mb-1">Gold</span>
                      <span className="text-yellow-400 font-bold text-2xl">{resources.gold}</span>
                    </div>
                  )}
                  {Object.entries(resources)
                    .filter(([key]) => key !== 'gold' && key !== 'contacts')
                    .map(([key, value]) => (
                      <div key={key} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                        <span className="text-gray-400 text-sm block mb-1 capitalize">{key}</span>
                        <span className="text-white font-bold text-xl">{String(value)}</span>
                      </div>
                    ))}
                  {resources.contacts && resources.contacts.length > 0 && (
                    <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 md:col-span-3">
                      <span className="text-gray-400 text-sm block mb-2">Contacts</span>
                      <div className="flex flex-wrap gap-2">
                        {resources.contacts.map((contact: string, idx: number) => (
                          <span key={idx} className="text-xs bg-blue-900/30 text-blue-400 px-3 py-1 rounded-full border border-blue-700/30">
                            {contact}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!equipment.weapon && !equipment.armor && items.length === 0 && Object.keys(resources).length === 0 && (
              <div className="card md:col-span-2">
                <div className="text-center py-8 text-gray-500">
                  <div className="text-4xl mb-2">🎒</div>
                  <p className="text-sm">No items or equipment</p>
                  <p className="text-xs mt-1">Your inventory is empty</p>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'relationships' && (
          <div className="space-y-6">
            <div className="card bg-indigo-900/10 border-indigo-700/30">
              <p className="text-sm text-gray-400 italic">
                Your character's relationships with NPCs and factions. These develop organically through your actions and choices in the story.
              </p>
            </div>

            {allConsequences.filter(c => c.type === 'enemy').length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wide mb-3">⚔️ Enemies</h3>
                <div className="space-y-3">
                  {allConsequences
                    .filter(c => c.type === 'enemy')
                    .map((cons, idx) => (
                      <div key={idx} className="bg-red-900/20 rounded-lg p-4 border border-red-700/50">
                        <p className="text-sm text-red-300">{cons.description}</p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {allConsequences.filter(c => c.type === 'promise').length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-blue-400 uppercase tracking-wide mb-3">🤝 Promises</h3>
                <div className="space-y-3">
                  {allConsequences
                    .filter(c => c.type === 'promise')
                    .map((cons, idx) => (
                      <div key={idx} className="bg-blue-900/20 rounded-lg p-4 border border-blue-700/50">
                        <p className="text-sm text-blue-300">{cons.description}</p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {allConsequences.filter(c => c.type === 'debt').length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-yellow-400 uppercase tracking-wide mb-3">💰 Debts</h3>
                <div className="space-y-3">
                  {allConsequences
                    .filter(c => c.type === 'debt')
                    .map((cons, idx) => (
                      <div key={idx} className="bg-yellow-900/20 rounded-lg p-4 border border-yellow-700/50">
                        <p className="text-sm text-yellow-300">{cons.description}</p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {allConsequences.filter(c => c.type === 'longTermThreat').length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-purple-400 uppercase tracking-wide mb-3">⚠️ Long-Term Threats</h3>
                <div className="space-y-3">
                  {allConsequences
                    .filter(c => c.type === 'longTermThreat')
                    .map((cons, idx) => (
                      <div key={idx} className="bg-purple-900/20 rounded-lg p-4 border border-purple-700/50">
                        <p className="text-sm text-purple-300">{cons.description}</p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {allConsequences.length === 0 && (
              <div className="card">
                <div className="text-center py-12 text-gray-500">
                  <div className="text-6xl mb-4">🌟</div>
                  <p className="text-lg mb-1">No significant relationships yet</p>
                  <p className="text-sm">Your actions will shape these over time</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
