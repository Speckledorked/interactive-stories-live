// src/components/character/CharacterSnapshotModal.tsx
// Quick character state reference modal for use during story scenes

'use client'

import { useEffect, useState } from 'react'
import { useEscapeKey } from '@/hooks/useEscapeKey'
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

  // Close on escape key. Called unconditionally (before the `if (!isOpen)
  // return null` below) rather than being skipped via an early return, so
  // this component calls the same hooks in the same order every render —
  // this component is mounted whenever a character is selected and stays
  // mounted as `isOpen` toggles (see story/page.tsx), so a hook declared
  // after that early return would be called a different number of times
  // between renders of the same instance.
  useEscapeKey(onClose, isOpen)

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
      <div className="bg-myth-surface-raised rounded-lg border border-myth-border shadow-2xl shadow-black/50 max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-myth-border bg-myth-surface-sunken">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 flex-1">
              {character && <CharacterAvatar name={character.name} size="md" />}
              <div>
                <h2 className="font-display text-xl text-myth-ink">
                  {character?.name || 'Loading...'}
                </h2>
                {character?.pronouns && (
                  <p className="text-sm text-myth-ink-muted">{character.pronouns}</p>
                )}
                {character?.concept && (
                  <p className="text-sm text-myth-ink-muted italic">{character.concept}</p>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-myth-ink-faint hover:text-myth-ink transition-colors text-xl"
            >
              ✕
            </button>
          </div>

          {/* Quick Info */}
          {character && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {character.currentLocation && (
                <div className="text-xs">
                  <span className="text-myth-ink-faint">Location: </span>
                  <span className="text-myth-ink-muted">{character.currentLocation}</span>
                </div>
              )}
              <div className="text-xs">
                <span className="text-myth-ink-faint">Health: </span>
                <span className={`font-semibold ${character.harm >= 4 ? 'text-myth-danger' : character.harm >= 2 ? 'text-myth-warn' : 'text-myth-good'}`}>
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
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-myth-accent"></div>
            </div>
          ) : character ? (
            <>
              {/* Tabs */}
              <div className="flex border-b border-myth-border bg-myth-surface-sunken sticky top-0 z-10">
                {[
                  { key: 'stats', label: 'Stats & Status', icon: '📊' },
                  { key: 'inventory', label: 'Inventory', icon: '🎒' },
                  { key: 'relationships', label: 'Ties', icon: '💕' }
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key as any)}
                    className={`flex-1 py-3 px-4 text-sm font-medium transition-colors border-b-2 ${
                      activeTab === tab.key
                        ? 'border-myth-accent text-myth-ink bg-myth-surface-sunken'
                        : 'border-transparent text-myth-ink-faint hover:text-myth-ink-muted hover:bg-myth-surface-sunken'
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
                      <h3 className="text-sm font-medium uppercase tracking-wide text-myth-ink-faint mb-2">HARM</h3>
                      <HarmTracker current={character.harm} max={6} />
                    </div>

                    {/* Stats */}
                    {statEntries.length > 0 && (
                      <div>
                        <h3 className="text-sm font-medium uppercase tracking-wide text-myth-ink-faint mb-2">STATS</h3>
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
                        <h3 className="text-sm font-medium uppercase tracking-wide text-myth-ink-faint mb-2">CONDITIONS</h3>
                        <div className="flex flex-wrap gap-2">
                          {conditionsList.map((cond: any, idx: number) => (
                            <span
                              key={idx}
                              className="px-3 py-1 bg-myth-danger/10 text-myth-danger rounded-full text-xs font-medium border border-myth-danger/30"
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
                        <h3 className="text-sm font-medium uppercase tracking-wide text-myth-ink-faint mb-2">PERKS & ABILITIES</h3>
                        <div className="space-y-2">
                          {perksList.slice(0, 5).map((perk: any, idx: number) => (
                            <div key={idx} className="bg-myth-surface-sunken rounded-lg p-3 border border-myth-border">
                              <div className="font-medium text-myth-ink text-sm">
                                {perk.name || perk}
                              </div>
                              {perk.description && (
                                <p className="text-xs text-myth-ink-muted mt-1">{perk.description}</p>
                              )}
                            </div>
                          ))}
                          {perksList.length > 5 && (
                            <p className="text-xs text-myth-ink-faint italic">
                              +{perksList.length - 5} more...
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Consequences */}
                    {allConsequences.length > 0 && (
                      <div>
                        <h3 className="text-sm font-medium uppercase tracking-wide text-myth-ink-faint mb-2">CONSEQUENCES</h3>
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
                        <h3 className="text-sm font-medium uppercase tracking-wide text-myth-ink-faint mb-2">EQUIPPED</h3>
                        <div className="space-y-2">
                          {equipment.weapon && (
                            <div className="bg-myth-surface-sunken rounded-lg p-3 border border-myth-border">
                              <span className="text-xs text-myth-ink-faint">Weapon:</span>
                              <p className="text-myth-ink font-medium">
                                {typeof equipment.weapon === 'string' ? equipment.weapon : equipment.weapon.name}
                              </p>
                            </div>
                          )}
                          {equipment.armor && (
                            <div className="bg-myth-surface-sunken rounded-lg p-3 border border-myth-border">
                              <span className="text-xs text-myth-ink-faint">Armor:</span>
                              <p className="text-myth-ink font-medium">
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
                        <h3 className="text-sm font-medium uppercase tracking-wide text-myth-ink-faint mb-2">INVENTORY</h3>
                        <div className="grid grid-cols-2 gap-2">
                          {items.map((item: any, idx: number) => (
                            <div key={idx} className="bg-myth-surface-sunken rounded-lg p-2 border border-myth-border">
                              <div className="text-sm text-myth-ink font-medium">
                                {typeof item === 'string' ? item : item.name}
                              </div>
                              {item.quantity && (
                                <div className="text-xs text-myth-ink-faint">×{item.quantity}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Resources */}
                    {(resources.gold !== undefined || resources.contacts?.length > 0) && (
                      <div>
                        <h3 className="text-sm font-medium uppercase tracking-wide text-myth-ink-faint mb-2">RESOURCES</h3>
                        <div className="space-y-2">
                          {resources.gold !== undefined && (
                            <div className="flex items-center justify-between bg-myth-surface-sunken rounded-lg p-3 border border-myth-border">
                              <span className="text-myth-ink-muted">Gold</span>
                              <span className="text-myth-ink font-bold">{resources.gold}</span>
                            </div>
                          )}
                          {resources.contacts && resources.contacts.length > 0 && (
                            <div className="bg-myth-surface-sunken rounded-lg p-3 border border-myth-border">
                              <span className="text-xs text-myth-ink-faint block mb-1">Contacts:</span>
                              <div className="flex flex-wrap gap-1">
                                {resources.contacts.map((contact: string, idx: number) => (
                                  <span key={idx} className="text-xs bg-myth-surface text-myth-ink-muted px-2 py-1 rounded border border-myth-border">
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
                    <p className="text-sm text-myth-ink-muted italic">
                      The promises, debts, enemies and lasting threats your choices have created.
                    </p>

                    {allConsequences.filter(c => c.type === 'enemy').length > 0 && (
                      <div>
                        <h3 className="text-sm font-medium text-myth-danger mb-2">⚔️ ENEMIES</h3>
                        <div className="space-y-2">
                          {allConsequences
                            .filter(c => c.type === 'enemy')
                            .map((cons, idx) => (
                              <div key={idx} className="bg-myth-danger/10 rounded-lg p-3 border border-myth-danger/30">
                                <p className="text-sm text-myth-danger">{cons.description}</p>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {allConsequences.filter(c => c.type === 'promise').length > 0 && (
                      <div>
                        <h3 className="text-sm font-medium text-myth-good mb-2">🤝 PROMISES</h3>
                        <div className="space-y-2">
                          {allConsequences
                            .filter(c => c.type === 'promise')
                            .map((cons, idx) => (
                              <div key={idx} className="bg-myth-good/10 rounded-lg p-3 border border-myth-good/30">
                                <p className="text-sm text-myth-ink">{cons.description}</p>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {allConsequences.filter(c => c.type === 'debt').length > 0 && (
                      <div>
                        <h3 className="text-sm font-medium text-myth-warn mb-2">💰 DEBTS</h3>
                        <div className="space-y-2">
                          {allConsequences
                            .filter(c => c.type === 'debt')
                            .map((cons, idx) => (
                              <div key={idx} className="bg-myth-warn/10 rounded-lg p-3 border border-myth-warn/30">
                                <p className="text-sm text-myth-warn">{cons.description}</p>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {allConsequences.length === 0 && (
                      <div className="text-center py-8 text-myth-ink-faint">
                        <div className="text-4xl mb-2">🌟</div>
                        <p className="text-sm">No lasting ties yet</p>
                        <p className="text-xs mt-1">Your actions will shape these over time</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-myth-ink-faint">
              <p>Character not found</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-myth-border bg-myth-surface-sunken">
          <div className="flex items-center justify-between">
            <button
              onClick={onClose}
              className="rounded-md border border-myth-border px-4 py-2 text-sm font-medium text-myth-ink-muted transition-colors hover:border-myth-border-strong hover:text-myth-ink"
            >
              Close
            </button>
            <a
              href={`/campaigns/${campaignId}/characters/${characterId}`}
              className="rounded-md bg-myth-accent px-4 py-2 text-sm font-medium text-myth-accent-ink transition-colors hover:bg-myth-accent-hover"
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
