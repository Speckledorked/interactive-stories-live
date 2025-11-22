// src/app/campaigns/[id]/characters/[characterId]/page.tsx
// Character sheet - comprehensive view of character details

'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { authenticatedFetch, isAuthenticated } from '@/lib/clientAuth'

export default function CharacterSheetPage() {
  const router = useRouter()
  const params = useParams()
  const campaignId = params.id as string
  const characterId = params.characterId as string

  const [character, setCharacter] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'overview' | 'stats' | 'inventory' | 'background' | 'consequences'>('overview')

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    loadCharacter()
  }, [characterId])

  const loadCharacter = async () => {
    setLoading(true)
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/characters/${characterId}`)
      if (!response.ok) throw new Error('Failed to load character')

      const data = await response.json()
      setCharacter(data.character)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load character')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    )
  }

  if (error || !character) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="bg-red-900/20 border border-red-500 text-red-400 p-4 rounded-md">
          {error || 'Character not found'}
        </div>
      </div>
    )
  }

  const stats = character.stats as any || {}
  const equipment = character.equipment as any || {}
  const inventory = character.inventory as any || { items: [] }
  const resources = character.resources as any || {}
  const consequences = character.consequences as any || {}
  const perks = character.perks as any || []
  const relationships = character.relationships as any || {}

  const tabs = [
    { key: 'overview' as const, label: 'Overview', icon: '📋' },
    { key: 'stats' as const, label: 'Stats & Abilities', icon: '⚡' },
    { key: 'inventory' as const, label: 'Equipment & Inventory', icon: '🎒' },
    { key: 'background' as const, label: 'Background', icon: '📖' },
    { key: 'consequences' as const, label: 'Debts & Enemies', icon: '⚔️' },
  ]

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link
          href={`/campaigns/${campaignId}`}
          className="text-sm text-gray-400 hover:text-white mb-2 inline-block"
        >
          ← Back to Campaign
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">{character.name}</h1>
            {character.pronouns && (
              <p className="text-gray-400 mt-1">({character.pronouns})</p>
            )}
            {character.description && (
              <p className="text-gray-300 mt-2">{character.description}</p>
            )}
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-400">Status</div>
            <div className="text-lg font-bold text-green-400">{character.isAlive ? 'Active' : 'Inactive'}</div>
          </div>
        </div>
      </div>

      {/* Quick Stats Bar */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="card text-center">
          <div className="text-xs text-gray-400 mb-1">Health</div>
          <div className="text-xl font-bold text-green-400">{6 - (character.harm || 0)}/6</div>
        </div>
        <div className="card text-center">
          <div className="text-xs text-gray-400 mb-1">Gold</div>
          <div className="text-xl font-bold text-yellow-400">{resources.gold || 0}</div>
        </div>
        <div className="card text-center">
          <div className="text-xs text-gray-400 mb-1">Inventory</div>
          <div className="text-xl font-bold text-blue-400">{inventory.items?.length || 0}/{inventory.slots || 10}</div>
        </div>
        <div className="card text-center">
          <div className="text-xs text-gray-400 mb-1">Location</div>
          <div className="text-sm font-medium text-white truncate">{character.currentLocation || 'Unknown'}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-700 mb-6">
        <nav className="flex space-x-6 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors whitespace-nowrap flex items-center gap-2 ${
                activeTab === tab.key
                  ? 'border-primary-500 text-primary-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Character Info */}
            <div className="card">
              <h2 className="text-xl font-bold text-white mb-4">Character Information</h2>

              {character.appearance && (
                <div className="mb-4">
                  <h3 className="text-sm font-bold text-gray-400 mb-2">Appearance</h3>
                  <p className="text-gray-300">{character.appearance}</p>
                </div>
              )}

              {character.personality && (
                <div className="mb-4">
                  <h3 className="text-sm font-bold text-gray-400 mb-2">Personality</h3>
                  <p className="text-gray-300">{character.personality}</p>
                </div>
              )}

              {character.goals && (
                <div>
                  <h3 className="text-sm font-bold text-gray-400 mb-2">Goals</h3>
                  <p className="text-gray-300">{character.goals}</p>
                </div>
              )}
            </div>

            {/* Quick Stats */}
            <div className="card">
              <h2 className="text-xl font-bold text-white mb-4">Core Stats</h2>
              <div className="space-y-3">
                {Object.entries(stats).map(([stat, value]: [string, any]) => (
                  <div key={stat} className="flex items-center justify-between">
                    <span className="text-sm font-medium capitalize text-gray-300">{stat}</span>
                    <span className="text-lg font-bold text-white">
                      {(value as number) >= 0 ? '+' : ''}{value}
                    </span>
                  </div>
                ))}
              </div>

              {character.moves && character.moves.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-bold text-gray-400 mb-2">Special Moves</h3>
                  <div className="space-y-1">
                    {character.moves.map((move: string, i: number) => (
                      <div key={i} className="text-sm text-primary-300">{move}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Equipment Overview */}
            <div className="card">
              <h2 className="text-xl font-bold text-white mb-4">Equipment</h2>
              <div className="space-y-3">
                {equipment.weapon && (
                  <div>
                    <span className="text-xs text-gray-400">Weapon: </span>
                    <span className="text-sm text-white">{equipment.weapon}</span>
                  </div>
                )}
                {equipment.armor && (
                  <div>
                    <span className="text-xs text-gray-400">Armor: </span>
                    <span className="text-sm text-white">{equipment.armor}</span>
                  </div>
                )}
                {equipment.misc && (
                  <div>
                    <span className="text-xs text-gray-400">Accessory: </span>
                    <span className="text-sm text-white">{equipment.misc}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Contacts */}
            {resources.contacts && resources.contacts.length > 0 && (
              <div className="card">
                <h2 className="text-xl font-bold text-white mb-4">Contacts & Allies</h2>
                <ul className="space-y-2">
                  {resources.contacts.map((contact: string, i: number) => (
                    <li key={i} className="text-sm text-gray-300 flex items-center gap-2">
                      <span className="text-primary-400">•</span>
                      {contact}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Stats & Abilities Tab */}
        {activeTab === 'stats' && (
          <div className="space-y-6">
            <div className="card">
              <h2 className="text-xl font-bold text-white mb-4">Character Stats</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {Object.entries(stats).map(([stat, value]: [string, any]) => (
                  <div key={stat} className="bg-gray-800 rounded-lg p-4 text-center border border-gray-700">
                    <div className="text-2xl font-bold text-white mb-1">
                      {(value as number) >= 0 ? '+' : ''}{value}
                    </div>
                    <div className="text-sm font-medium capitalize text-gray-400">{stat}</div>
                  </div>
                ))}
              </div>
            </div>

            {Array.isArray(perks) && perks.length > 0 && (
              <div className="card">
                <h2 className="text-xl font-bold text-white mb-4">Abilities & Perks</h2>
                <div className="space-y-3">
                  {perks.map((perk: any, i: number) => (
                    <div key={i} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                      <h3 className="font-bold text-white mb-1">{perk.name}</h3>
                      <p className="text-sm text-gray-300">{perk.description}</p>
                      {perk.tags && perk.tags.length > 0 && (
                        <div className="flex gap-1 mt-2">
                          {perk.tags.map((tag: string, j: number) => (
                            <span key={j} className="text-xs px-2 py-0.5 bg-gray-700 text-gray-400 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {character.moves && character.moves.length > 0 && (
              <div className="card">
                <h2 className="text-xl font-bold text-white mb-4">Special Moves</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {character.moves.map((move: string, i: number) => (
                    <div key={i} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                      <div className="text-sm text-primary-300">{move}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="card bg-gradient-to-br from-gray-900 to-gray-800 border-primary-700">
              <h2 className="text-xl font-bold text-white mb-2">Character Advancement</h2>
              <p className="text-sm text-gray-400 mb-4">
                Your character grows organically based on their actions in the story. The AI awards new abilities, stat increases, and perks as you demonstrate mastery and face challenges.
              </p>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Stats Unlocked</span>
                  <span className="text-lg font-bold text-primary-400">{Object.keys(stats).length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Perks Gained</span>
                  <span className="text-lg font-bold text-purple-400">{Array.isArray(perks) ? perks.length : 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Moves Known</span>
                  <span className="text-lg font-bold text-blue-400">{character.moves?.length || 0}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-gray-700">
                  <span className="text-sm text-gray-400">Current Harm</span>
                  <span className="text-lg font-bold text-red-400">{character.harm || 0} / 6</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Inventory Tab */}
        {activeTab === 'inventory' && (
          <div className="space-y-6">
            <div className="card">
              <h2 className="text-xl font-bold text-white mb-4">Equipment</h2>
              <div className="space-y-4">
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                  <div className="text-xs text-gray-400 mb-1">Primary Weapon</div>
                  <div className="text-lg text-white">{equipment.weapon || 'None'}</div>
                </div>
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                  <div className="text-xs text-gray-400 mb-1">Armor / Protection</div>
                  <div className="text-lg text-white">{equipment.armor || 'None'}</div>
                </div>
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                  <div className="text-xs text-gray-400 mb-1">Accessory / Misc</div>
                  <div className="text-lg text-white">{equipment.misc || 'None'}</div>
                </div>
              </div>
            </div>

            <div className="card">
              <h2 className="text-xl font-bold text-white mb-4">
                Inventory ({inventory.items?.length || 0}/{inventory.slots || 10} slots)
              </h2>
              {inventory.items && inventory.items.length > 0 ? (
                <div className="space-y-2">
                  {inventory.items.map((item: any, i: number) => (
                    <div key={i} className="bg-gray-800 border border-gray-700 rounded-lg p-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-white">{item.name}</div>
                        {item.tags && item.tags.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {item.tags.map((tag: string, j: number) => (
                              <span key={j} className="text-xs px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      {item.quantity > 1 && (
                        <span className="text-gray-400 font-medium">x{item.quantity}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No items in inventory
                </div>
              )}
            </div>

            <div className="card">
              <h2 className="text-xl font-bold text-white mb-4">Resources</h2>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Gold / Currency</span>
                  <span className="text-lg font-bold text-yellow-400">{resources.gold || 0}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Background Tab */}
        {activeTab === 'background' && (
          <div className="space-y-6">
            {character.backstory && (
              <div className="card">
                <h2 className="text-xl font-bold text-white mb-4">Backstory</h2>
                <p className="text-gray-300 whitespace-pre-wrap">{character.backstory}</p>
              </div>
            )}

            {character.goals && (
              <div className="card">
                <h2 className="text-xl font-bold text-white mb-4">Goals & Motivations</h2>
                <p className="text-gray-300 whitespace-pre-wrap">{character.goals}</p>
              </div>
            )}

            {character.personality && (
              <div className="card">
                <h2 className="text-xl font-bold text-white mb-4">Personality</h2>
                <p className="text-gray-300 whitespace-pre-wrap">{character.personality}</p>
              </div>
            )}

            {resources.contacts && resources.contacts.length > 0 && (
              <div className="card">
                <h2 className="text-xl font-bold text-white mb-4">Contacts & Allies</h2>
                <ul className="space-y-2">
                  {resources.contacts.map((contact: string, i: number) => (
                    <li key={i} className="text-sm text-gray-300 flex items-center gap-2">
                      <span className="text-primary-400">•</span>
                      {contact}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Consequences Tab */}
        {activeTab === 'consequences' && (
          <div className="space-y-6">
            {consequences.promises && consequences.promises.length > 0 && (
              <div className="card">
                <h2 className="text-xl font-bold text-white mb-4">Promises & Oaths</h2>
                <ul className="space-y-2">
                  {consequences.promises.map((promise: string, i: number) => (
                    <li key={i} className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-300">
                      {promise}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {consequences.debts && consequences.debts.length > 0 && (
              <div className="card">
                <h2 className="text-xl font-bold text-white mb-4">Debts & Favors Owed</h2>
                <ul className="space-y-2">
                  {consequences.debts.map((debt: string, i: number) => (
                    <li key={i} className="bg-gray-800 border border-yellow-700 rounded-lg p-3 text-sm text-yellow-200">
                      {debt}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {consequences.enemies && consequences.enemies.length > 0 && (
              <div className="card">
                <h2 className="text-xl font-bold text-white mb-4">Enemies & Rivals</h2>
                <ul className="space-y-2">
                  {consequences.enemies.map((enemy: string, i: number) => (
                    <li key={i} className="bg-gray-800 border border-red-700 rounded-lg p-3 text-sm text-red-200">
                      {enemy}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(!consequences.promises || consequences.promises.length === 0) &&
              (!consequences.debts || consequences.debts.length === 0) &&
              (!consequences.enemies || consequences.enemies.length === 0) && (
                <div className="card text-center py-12">
                  <div className="text-6xl mb-4">✨</div>
                  <p className="text-gray-400">No debts, promises, or enemies... yet.</p>
                  <p className="text-sm text-gray-500 mt-2">These will develop as your story unfolds.</p>
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  )
}
