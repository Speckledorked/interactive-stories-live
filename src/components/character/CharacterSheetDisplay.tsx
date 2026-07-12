// src/components/character/CharacterSheetDisplay.tsx
// Full character sheet display for dedicated character page

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import HarmTracker from './HarmTracker'
import StatBar from './StatBar'
import CharacterAvatar from './CharacterAvatar'
import ConsequenceBadge from './ConsequenceBadge'

interface CharacterSheetDisplayProps {
  character: any
  campaign?: any
}

// Helper function to get currency name based on universe
function getCurrencyName(universe?: string): { singular: string; plural: string; icon: string } {
  if (!universe) return { singular: 'gold', plural: 'gold', icon: '💰' }

  const lowerUniverse = universe.toLowerCase()

  // My Hero Academia / Modern settings
  if (lowerUniverse.includes('hero') || lowerUniverse.includes('mha') || lowerUniverse.includes('modern')) {
    if (lowerUniverse.includes('japan')) {
      return { singular: 'yen', plural: 'yen', icon: '¥' }
    }
    return { singular: 'dollar', plural: 'dollars', icon: '$' }
  }

  // Sci-fi settings
  if (lowerUniverse.includes('space') || lowerUniverse.includes('sci-fi') || lowerUniverse.includes('cyberpunk')) {
    return { singular: 'credit', plural: 'credits', icon: '💳' }
  }

  // Post-apocalyptic
  if (lowerUniverse.includes('apocalypse') || lowerUniverse.includes('wasteland')) {
    return { singular: 'cap', plural: 'caps', icon: '🔘' }
  }

  // Default to gold for fantasy
  return { singular: 'gold', plural: 'gold', icon: '💰' }
}

export default function CharacterSheetDisplay({ character, campaign }: CharacterSheetDisplayProps) {
  const params = useParams()
  const campaignId = params?.id as string
  const [activeTab, setActiveTab] = useState<'overview' | 'stats' | 'inventory' | 'relationships' | 'advancement'>('overview')

  // Get currency info from campaign universe
  const currency = getCurrencyName(campaign?.universe)

  if (!character) {
    return (
      <div className="text-center py-12 text-ember-400/50">
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

  // Knowledge-relative sheet (server ships bands + hints only, never raw
  // proficiency numbers — see the character GET route)
  const capabilitySummary = character?.capabilitySummary as {
    known: Array<{ name: string; domain: string; band: string; description: string | null }>
    glimpsed: Array<{ domain: string; hint: string | null }>
    knownDomains: string[]
  } | undefined
  const capabilityDomains: string[] = capabilitySummary?.knownDomains || []

  // Debt economy — diegetic summary from the character GET route
  const debtSummary = character?.debtSummary as {
    owedByCharacter: Array<{ counterparty: string; description: string }>
    owedToCharacter: Array<{ counterparty: string; description: string }>
  } | undefined
  const hasDebts = !!debtSummary && (debtSummary.owedByCharacter.length > 0 || debtSummary.owedToCharacter.length > 0)

  // Faction standing — qualitative labels only ("honored by", "hostile with")
  const standingSummary = (character?.standingSummary || []) as Array<{ faction: string; label: string }>

  // Parse moves
  const moves = character?.moves || []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-ember-900/25 via-wine-800/15 to-ember-900/20 rounded-xl p-6 border border-ember-800/30">
        <div className="flex items-start gap-4">
          <CharacterAvatar name={character.name} size="lg" />
          <div className="flex-1">
            <h2 className="text-3xl font-bold text-ember-100 mb-1">
              {character.name}
            </h2>
            {character.pronouns && (
              <p className="text-sm text-ember-300/60 mb-2">{character.pronouns}</p>
            )}
            {character.concept && (
              <p className="text-lg text-ember-300 italic mb-3">{character.concept}</p>
            )}

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              {character.currentLocation && (
                <div className="bg-black/25 rounded-lg p-3 border border-ember-900/20">
                  <div className="text-xs text-ember-400/50 uppercase tracking-wide mb-1">Location</div>
                  <div className="text-sm text-ember-100 font-medium">{character.currentLocation}</div>
                </div>
              )}
              <div className="bg-black/25 rounded-lg p-3 border border-ember-900/20">
                <div className="text-xs text-ember-400/50 uppercase tracking-wide mb-1">Harm</div>
                <div className={`text-lg font-bold ${character.harm >= 4 ? 'text-wine-400' : character.harm >= 2 ? 'text-ember-300' : 'text-success-400'}`}>
                  {character.harm}/6
                </div>
              </div>
              {character.xp !== undefined && (
                <div className="bg-black/25 rounded-lg p-3 border border-ember-900/20">
                  <div className="text-xs text-ember-400/50 uppercase tracking-wide mb-1">XP</div>
                  <div className="text-lg font-bold text-ember-300">{character.xp}</div>
                </div>
              )}
              {statEntries.length > 0 && (
                <div className="bg-black/25 rounded-lg p-3 border border-ember-900/20">
                  <div className="text-xs text-ember-400/50 uppercase tracking-wide mb-1">Stat Total</div>
                  <div className="text-lg font-bold text-wine-300">
                    {statEntries.reduce((sum, [_, val]) => sum + (val as number), 0) > 0 ? '+' : ''}
                    {statEntries.reduce((sum, [_, val]) => sum + (val as number), 0)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 border-b border-ember-900/30 pb-2">
        {[
          { key: 'overview', label: 'Overview', icon: '📋' },
          { key: 'stats', label: 'Stats & Status', icon: '📊' },
          { key: 'inventory', label: 'Inventory', icon: '🎒' },
          { key: 'relationships', label: 'Relationships', icon: '💕' },
          { key: 'advancement', label: 'Advancement', icon: '⭐' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-gradient-to-r from-wine-600 to-wine-700 text-ember-100 shadow-lg shadow-black/40'
                : 'text-ember-300/50 hover:text-ember-100 hover:bg-black/25'
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
                <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-3">Description</h3>
                <p className="text-ember-200/70 leading-relaxed">{character.description}</p>
              </div>
            )}

            {/* Appearance */}
            {character.appearance && (
              <div className="card">
                <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-3">Appearance</h3>
                <p className="text-ember-200/70 leading-relaxed">{character.appearance}</p>
              </div>
            )}

            {/* Personality */}
            {character.personality && (
              <div className="card">
                <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-3">Personality</h3>
                <p className="text-ember-200/70 leading-relaxed">{character.personality}</p>
              </div>
            )}

            {/* Backstory */}
            {character.backstory && (
              <div className="card">
                <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-3">Backstory</h3>
                <p className="text-ember-200/70 leading-relaxed">{character.backstory}</p>
              </div>
            )}

            {/* Goals */}
            {character.goals && (
              <div className="card">
                <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-3">Goals</h3>
                <p className="text-ember-200/70 leading-relaxed">{character.goals}</p>
              </div>
            )}

            {/* Moves */}
            {moves.length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-3">Moves</h3>
                <div className="space-y-2">
                  {moves.map((move: string, idx: number) => (
                    <div key={idx} className="bg-ember-900/20 rounded-lg p-3 border border-ember-700/30">
                      <div className="text-sm text-ember-300 font-medium">{move}</div>
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
              <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-3">Harm</h3>
              <HarmTracker current={character.harm} max={6} />
            </div>

            {/* Stats */}
            {statEntries.length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-3">Stats</h3>
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
                <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-3">Conditions</h3>
                <div className="flex flex-wrap gap-2">
                  {conditionsList.map((cond: any, idx: number) => (
                    <span
                      key={idx}
                      className="px-3 py-1 bg-wine-800/30 text-wine-300 rounded-full text-xs font-medium border border-wine-600/40"
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
                <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-3">Perks & Abilities</h3>
                <div className="grid md:grid-cols-2 gap-3">
                  {perksList.map((perk: any, idx: number) => (
                    <div key={idx} className="bg-gradient-to-r from-ember-900/20 to-wine-800/15 rounded-lg p-4 border border-ember-800/30">
                      <div className="font-medium text-ember-300 mb-1">
                        {perk.name || perk}
                      </div>
                      {perk.description && (
                        <p className="text-xs text-ember-300/60">{perk.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Abilities & Knowledge — the knowledge-relative sheet. What
                renders here is what the character KNOWS: unlocked abilities
                show with a qualitative skill band, glimpsed ones as "???",
                and everything they've never encountered simply isn't here. */}
            {capabilitySummary && (capabilitySummary.known.length > 0 || capabilitySummary.glimpsed.length > 0) && (
              <div className="card md:col-span-2">
                <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-3">Abilities & Knowledge</h3>
                <div className="space-y-4">
                  {capabilityDomains.map(domain => (
                    <div key={domain}>
                      <div className="text-xs font-semibold text-ember-400/50 uppercase tracking-wide mb-2">{domain}</div>
                      <div className="grid md:grid-cols-2 gap-3">
                        {capabilitySummary.known
                          .filter((k: any) => k.domain === domain)
                          .map((k: any, idx: number) => (
                            <div key={`k-${idx}`} className="bg-gradient-to-r from-ember-900/20 to-wine-800/15 rounded-lg p-4 border border-ember-800/30">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="font-medium text-ember-300">{k.name}</span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-ember-800/40 text-ember-300/80 capitalize whitespace-nowrap">{k.band}</span>
                              </div>
                              {k.description && (
                                <p className="text-xs text-ember-300/60">{k.description}</p>
                              )}
                            </div>
                          ))}
                        {capabilitySummary.glimpsed
                          .filter((g: any) => g.domain === domain)
                          .map((g: any, idx: number) => (
                            <div key={`g-${idx}`} className="rounded-lg p-4 border border-dashed border-ember-800/40 bg-obsidian-900/30">
                              <div className="font-medium text-ember-300/40 mb-1">???</div>
                              <p className="text-xs text-ember-300/40 italic">
                                {g.hint || 'You know something like this exists… but not what it is.'}
                              </p>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reputation — faction standing in the fiction's own language:
                how each faction's people treat you, never a number. */}
            {standingSummary.length > 0 && (
              <div className="card md:col-span-2">
                <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-3">Reputation</h3>
                <div className="flex flex-wrap gap-2">
                  {standingSummary.map((s, idx) => (
                    <span
                      key={idx}
                      className={`text-sm px-3 py-1.5 rounded-full border ${
                        s.label.startsWith('hunted') || s.label.startsWith('hostile') || s.label.startsWith('distrusted')
                          ? 'bg-wine-800/20 border-wine-800/40 text-wine-300'
                          : 'bg-ember-900/20 border-ember-800/40 text-ember-300'
                      }`}
                    >
                      {s.label.charAt(0).toUpperCase() + s.label.slice(1)} <span className="font-medium">{s.faction}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Obligations & Favors — the Debt economy, in the fiction's
                own language: who considers whom in whose debt, never a
                ledger counter. */}
            {hasDebts && (
              <div className="card md:col-span-2">
                <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-3">Obligations & Favors</h3>
                <div className="grid md:grid-cols-2 gap-3">
                  {debtSummary!.owedByCharacter.map((d, idx) => (
                    <div key={`ob-${idx}`} className="bg-gradient-to-r from-wine-800/20 to-obsidian-900/20 rounded-lg p-4 border border-wine-800/30">
                      <div className="font-medium text-wine-300 mb-1">
                        {d.counterparty} considers you in their debt
                      </div>
                      <p className="text-xs text-ember-300/60">{d.description}</p>
                    </div>
                  ))}
                  {debtSummary!.owedToCharacter.map((d, idx) => (
                    <div key={`ot-${idx}`} className="bg-gradient-to-r from-ember-900/20 to-obsidian-900/20 rounded-lg p-4 border border-ember-800/30">
                      <div className="font-medium text-ember-300 mb-1">
                        {d.counterparty} owes you
                      </div>
                      <p className="text-xs text-ember-300/60">{d.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Consequences */}
            {allConsequences.length > 0 && (
              <div className="card md:col-span-2">
                <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-3">Consequences</h3>
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
                <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-3">Equipped</h3>
                <div className="space-y-3">
                  {equipment.weapon && (
                    <div className="bg-black/25 rounded-lg p-3 border border-ember-900/30">
                      <span className="text-xs text-ember-400/50 block mb-1">Weapon</span>
                      <p className="text-ember-100 font-medium">
                        {typeof equipment.weapon === 'string' ? equipment.weapon : equipment.weapon.name}
                      </p>
                      {equipment.weapon.description && (
                        <p className="text-xs text-ember-300/60 mt-1">{equipment.weapon.description}</p>
                      )}
                    </div>
                  )}
                  {equipment.armor && (
                    <div className="bg-black/25 rounded-lg p-3 border border-ember-900/30">
                      <span className="text-xs text-ember-400/50 block mb-1">Armor</span>
                      <p className="text-ember-100 font-medium">
                        {typeof equipment.armor === 'string' ? equipment.armor : equipment.armor.name}
                      </p>
                      {equipment.armor.description && (
                        <p className="text-xs text-ember-300/60 mt-1">{equipment.armor.description}</p>
                      )}
                    </div>
                  )}
                  {equipment.misc && (
                    <div className="bg-black/25 rounded-lg p-3 border border-ember-900/30">
                      <span className="text-xs text-ember-400/50 block mb-1">Misc</span>
                      <p className="text-ember-100 font-medium">
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
                <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-3">Inventory</h3>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((item: any, idx: number) => (
                    <div key={idx} className="bg-black/25 rounded-lg p-3 border border-ember-900/30 hover:border-ember-600/40 transition-colors">
                      <div className="text-sm text-ember-100 font-medium">
                        {typeof item === 'string' ? item : item.name}
                      </div>
                      {item.quantity && (
                        <div className="text-xs text-ember-400/50">×{item.quantity}</div>
                      )}
                      {item.description && (
                        <div className="text-xs text-ember-300/60 mt-1">{item.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Resources */}
            {(resources.gold !== undefined || resources.contacts?.length > 0 || Object.keys(resources).length > 0) && (
              <div className="card md:col-span-2">
                <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-3">Resources</h3>
                <div className="grid md:grid-cols-3 gap-3">
                  {resources.gold !== undefined && (
                    <div className="bg-gradient-to-r from-ember-900/25 to-ember-800/20 rounded-lg p-4 border border-ember-700/30">
                      <span className="text-ember-300/60 text-sm block mb-1 capitalize">
                        {resources.gold === 1 ? currency.singular : currency.plural}
                      </span>
                      <span className="text-ember-300 font-bold text-2xl">
                        {currency.icon} {resources.gold}
                      </span>
                    </div>
                  )}
                  {Object.entries(resources)
                    .filter(([key]) => key !== 'gold' && key !== 'contacts')
                    .map(([key, value]) => (
                      <div key={key} className="bg-black/25 rounded-lg p-4 border border-ember-900/30">
                        <span className="text-ember-300/60 text-sm block mb-1 capitalize">{key.replace(/_/g, ' ')}</span>
                        <span className="text-ember-100 font-bold text-xl">
                          {typeof value === 'object' && value !== null ? (
                            // Handle reputation objects specially
                            key.toLowerCase().includes('reputation') ? (
                              <div className="space-y-1 text-sm">
                                {Object.entries(value as Record<string, number>).map(([faction, rep]) => (
                                  <div key={faction} className="flex justify-between items-center">
                                    <span className="text-ember-300/60">{faction}:</span>
                                    <span className={rep > 0 ? 'text-success-400' : rep < 0 ? 'text-wine-400' : 'text-ember-200/70'}>
                                      {rep > 0 ? '+' : ''}{rep}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : String(value)
                          ) : String(value)}
                        </span>
                      </div>
                    ))}
                  {resources.contacts && resources.contacts.length > 0 && (
                    <div className="bg-black/25 rounded-lg p-4 border border-ember-900/30 md:col-span-3">
                      <span className="text-ember-300/60 text-sm block mb-2">Contacts</span>
                      <div className="flex flex-wrap gap-2">
                        {resources.contacts.map((contact: string, idx: number) => (
                          <Link
                            key={idx}
                            href={`/campaigns/${campaignId}/wiki?type=NPC&search=${encodeURIComponent(contact)}`}
                            className="text-xs bg-ember-900/25 text-ember-300 px-3 py-1 rounded-full border border-ember-800/30 hover:bg-ember-900/40 hover:border-ember-700/40 transition-colors cursor-pointer"
                            title={`View ${contact} in wiki`}
                          >
                            {contact}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!equipment.weapon && !equipment.armor && items.length === 0 && Object.keys(resources).length === 0 && (
              <div className="card md:col-span-2">
                <div className="text-center py-8 text-ember-400/50">
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
            <div className="card bg-ember-900/10 border-ember-800/30">
              <p className="text-sm text-ember-300/60 italic">
                Your character's relationships with NPCs and factions. These develop organically through your actions and choices in the story.
              </p>
            </div>

            {allConsequences.filter(c => c.type === 'enemy').length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-wine-400 uppercase tracking-wide mb-3">⚔️ Enemies</h3>
                <div className="space-y-3">
                  {allConsequences
                    .filter(c => c.type === 'enemy')
                    .map((cons, idx) => (
                      <div key={idx} className="bg-wine-800/20 rounded-lg p-4 border border-wine-700/40">
                        <p className="text-sm text-wine-300">{cons.description}</p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {allConsequences.filter(c => c.type === 'promise').length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-ember-300 uppercase tracking-wide mb-3">🤝 Promises</h3>
                <div className="space-y-3">
                  {allConsequences
                    .filter(c => c.type === 'promise')
                    .map((cons, idx) => (
                      <div key={idx} className="bg-ember-900/20 rounded-lg p-4 border border-ember-700/40">
                        <p className="text-sm text-ember-200">{cons.description}</p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {allConsequences.filter(c => c.type === 'debt').length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-ember-400 uppercase tracking-wide mb-3">💰 Debts</h3>
                <div className="space-y-3">
                  {allConsequences
                    .filter(c => c.type === 'debt')
                    .map((cons, idx) => (
                      <div key={idx} className="bg-ember-900/15 rounded-lg p-4 border border-ember-800/30">
                        <p className="text-sm text-ember-300">{cons.description}</p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {allConsequences.filter(c => c.type === 'longTermThreat').length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-wine-300 uppercase tracking-wide mb-3">⚠️ Long-Term Threats</h3>
                <div className="space-y-3">
                  {allConsequences
                    .filter(c => c.type === 'longTermThreat')
                    .map((cons, idx) => (
                      <div key={idx} className="bg-wine-800/15 rounded-lg p-4 border border-wine-700/30">
                        <p className="text-sm text-wine-200">{cons.description}</p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {allConsequences.length === 0 && (
              <div className="card">
                <div className="text-center py-12 text-ember-400/50">
                  <div className="text-6xl mb-4">🌟</div>
                  <p className="text-lg mb-1">No significant relationships yet</p>
                  <p className="text-sm">Your actions will shape these over time</p>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'advancement' && (() => {
          const advLog = (character.advancementLog as any) || { entries: [], totalStatIncreases: 0, totalPerksGained: 0, totalMovesLearned: 0 }
          const entries: any[] = advLog.entries || []

          return (
            <div className="space-y-6">
              {/* Summary counters */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-black/20 rounded-lg p-4 border border-white/10 text-center">
                  <div className="text-2xl font-bold text-ember-300">{advLog.totalStatIncreases || 0}</div>
                  <div className="text-xs text-ember-400/50 uppercase tracking-wide mt-1">Stat Increases</div>
                </div>
                <div className="bg-black/20 rounded-lg p-4 border border-white/10 text-center">
                  <div className="text-2xl font-bold text-success-400">{advLog.totalPerksGained || 0}</div>
                  <div className="text-xs text-ember-400/50 uppercase tracking-wide mt-1">Perks Gained</div>
                </div>
                <div className="bg-black/20 rounded-lg p-4 border border-white/10 text-center">
                  <div className="text-2xl font-bold text-wine-300">{advLog.totalMovesLearned || 0}</div>
                  <div className="text-xs text-ember-400/50 uppercase tracking-wide mt-1">Moves Learned</div>
                </div>
              </div>

              {/* XP bar */}
              <div className="card">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide">Experience</h3>
                  <span className="text-lg font-bold text-ember-300">{character.experience || 0} XP</span>
                </div>
                <div className="w-full bg-black/30 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-ember-500 to-wine-600 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min(((character.experience || 0) % 100), 100)}%` }}
                  />
                </div>
              </div>

              {/* History */}
              <div className="card">
                <h3 className="text-sm font-semibold text-ember-400/60 uppercase tracking-wide mb-4">Growth History</h3>
                {entries.length === 0 ? (
                  <div className="text-center py-8 text-ember-400/50">
                    <div className="text-4xl mb-3">🌱</div>
                    <p>No advancements yet</p>
                    <p className="text-sm mt-1">Keep playing — your character grows organically through action</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {[...entries].reverse().map((entry: any, idx: number) => {
                      const date = new Date(entry.timestamp).toLocaleDateString()
                      const turnInfo = entry.turnNumber ? ` · Turn ${entry.turnNumber}` : ''
                      let icon = '⭐'
                      let color = 'text-ember-400'
                      let label = ''
                      if (entry.type === 'stat_increase') {
                        icon = '📈'
                        color = 'text-ember-300'
                        label = `${entry.details.statKey} ${entry.details.oldValue} → ${entry.details.newValue}`
                      } else if (entry.type === 'perk_gained') {
                        icon = '✨'
                        color = 'text-success-400'
                        label = entry.details.perkName || entry.details.perkId
                      } else if (entry.type === 'move_learned') {
                        icon = '🎯'
                        color = 'text-wine-300'
                        label = entry.details.moveId
                      }
                      return (
                        <div key={idx} className="flex items-start gap-3 bg-black/25 rounded-lg p-3 border border-ember-900/20">
                          <span className="text-lg">{icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className={`font-medium text-sm ${color}`}>{label}</div>
                            <div className="text-xs text-ember-400/50 mt-0.5">{entry.details.reason}</div>
                          </div>
                          <div className="text-xs text-ember-500/40 whitespace-nowrap">{date}{turnInfo}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
