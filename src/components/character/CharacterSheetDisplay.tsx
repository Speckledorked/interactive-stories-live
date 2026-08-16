// src/components/character/CharacterSheetDisplay.tsx
// Full character sheet display for dedicated character page

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { SpendPanel } from './SpendPanel'
import HarmTracker from './HarmTracker'
import StatBar from './StatBar'
import CharacterAvatar from './CharacterAvatar'
import ConsequenceBadge from './ConsequenceBadge'
import { DynamicDowntimeManager } from '@/components/downtime/DynamicDowntimeManager'
import { SectionHeader } from '@/components/ui/section-header'
import { parseCorruptionTheme, corruptionStage, MAX_CORRUPTION } from '@/lib/game/corruption'
import { Tabs } from '@/components/ui/tabs'
import { Backpack, BarChart3, Circle, ClipboardList, Coins, CreditCard, DollarSign, HeartHandshake, JapaneseYen, Moon, Sparkles, Sprout, Star, Target, TrendingUp } from 'lucide-react'
import { type IconComponent } from '@/lib/ui/icons'

interface CharacterSheetDisplayProps {
  character: any
  campaign?: any
  // Downtime — rendered in its own tab rather than always-on below the
  // sheet. Omit these props (or leave activities undefined) to hide the
  // tab entirely, e.g. when viewing another player's character.
  downtimeActivities?: any[]
  downtimeSuggestions?: string[]
  onCreateDowntimeActivity?: (description: string) => void
  onAdvanceDowntimeTime?: (characterId: string, days: number) => void
  onRespondToDowntimeEvent?: (eventId: string, response: string) => void
}

// Helper function to get currency name based on universe
function getCurrencyName(universe?: string): { singular: string; plural: string; icon: IconComponent } {
  if (!universe) return { singular: 'gold', plural: 'gold', icon: Coins }

  const lowerUniverse = universe.toLowerCase()

  // My Hero Academia / Modern settings
  if (lowerUniverse.includes('hero') || lowerUniverse.includes('mha') || lowerUniverse.includes('modern')) {
    if (lowerUniverse.includes('japan')) {
      return { singular: 'yen', plural: 'yen', icon: JapaneseYen }
    }
    return { singular: 'dollar', plural: 'dollars', icon: DollarSign }
  }

  // Sci-fi settings
  if (lowerUniverse.includes('space') || lowerUniverse.includes('sci-fi') || lowerUniverse.includes('cyberpunk')) {
    return { singular: 'credit', plural: 'credits', icon: CreditCard }
  }

  // Post-apocalyptic
  if (lowerUniverse.includes('apocalypse') || lowerUniverse.includes('wasteland')) {
    return { singular: 'cap', plural: 'caps', icon: Circle }
  }

  // Default to gold for fantasy
  return { singular: 'gold', plural: 'gold', icon: Coins }
}

// Reference/utility card — CRUD-ish or tabular content (see docs/design-system.md).
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-myth-border bg-myth-surface p-5 ${className}`}>
      {children}
    </div>
  )
}

// Small in-card eyebrow label, matching SectionHeader's eyebrow tier.
function CardLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={`mb-3 text-sm font-semibold uppercase tracking-wide text-myth-ink-faint ${className}`}>
      {children}
    </h3>
  )
}

export default function CharacterSheetDisplay({
  character,
  campaign,
  downtimeActivities,
  downtimeSuggestions,
  onCreateDowntimeActivity,
  onAdvanceDowntimeTime,
  onRespondToDowntimeEvent,
}: CharacterSheetDisplayProps) {
  const params = useParams()
  const campaignId = params?.id as string
  const [activeTab, setActiveTab] = useState<'overview' | 'stats' | 'inventory' | 'relationships' | 'advancement' | 'downtime'>('overview')
  const showDowntimeTab = downtimeActivities !== undefined

  // Get currency info from campaign universe
  const currency = getCurrencyName(campaign?.universe)

  if (!character) {
    return (
      <div className="py-12 text-center text-myth-ink-faint">
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
  // #173: the event ("was Restrained") is now tracked separately from
  // current state ("is Restrained") — see conditionHistory in harm.ts.
  const conditionHistoryList = conditions.conditionHistory || []

  // Structured, permanent declarative knowledge (#173/#174) — distinct
  // from capabilitySummary below (system existence + proficiency). See
  // lib/game/knowledge.ts.
  const knownConcepts = (character?.knownConcepts as any)?.concepts || []

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

  // Corruption — only exists when this campaign's universe has a
  // power-at-a-cost concept (Campaign.corruptionTheme); rendered
  // diegetically (staged prose, subtle marks), never as "3/5".
  const corruptionTheme = parseCorruptionTheme(campaign?.corruptionTheme)
  const corruptionValue = Math.max(0, Number(character?.corruption) || 0)
  const corruptionStageText = corruptionTheme ? corruptionStage(corruptionTheme, corruptionValue) : null

  // Parse moves — legacy rows may still hold bare strings; new rows are
  // {id, name, trigger, description} objects (see lib/game/advancement.ts)
  const moves = Array.isArray(character?.moves) ? character.moves : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-lg border border-myth-border bg-myth-surface p-6">
        <div className="flex items-start gap-4">
          <CharacterAvatar name={character.name} size="lg" />
          <div className="flex-1">
            <h2 className="font-display mb-1 text-3xl font-semibold text-myth-ink">
              {character.name}
            </h2>
            {character.pronouns && (
              <p className="mb-2 text-sm text-myth-ink-muted">{character.pronouns}</p>
            )}
            {character.concept && (
              <p className="mb-3 text-lg italic text-myth-ink-muted">{character.concept}</p>
            )}

            {/* Quick Stats Grid */}
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              {character.currentLocation && (
                <div className="rounded-lg border border-myth-border bg-myth-surface-sunken p-3">
                  <div className="mb-1 text-xs uppercase tracking-wide text-myth-ink-faint">Location</div>
                  <div className="text-sm font-medium text-myth-ink">{character.currentLocation}</div>
                </div>
              )}
              <div className="rounded-lg border border-myth-border bg-myth-surface-sunken p-3">
                <div className="mb-1 text-xs uppercase tracking-wide text-myth-ink-faint">Health</div>
                <div className={`text-lg font-bold ${character.harm >= 4 ? 'text-myth-danger' : character.harm >= 2 ? 'text-myth-warn' : 'text-myth-good'}`}>
                  {character.harm}/6
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Tabs
        variant="pill"
        aria-label="Character sheet sections"
        value={activeTab}
        onChange={(key) => setActiveTab(key as any)}
        className="mb-2"
        items={[
          { key: 'overview', label: 'Overview', icon: ClipboardList },
          { key: 'stats', label: 'Stats & Status', icon: BarChart3 },
          { key: 'inventory', label: 'Inventory', icon: Backpack },
          { key: 'relationships', label: 'Ties & Consequences', icon: HeartHandshake },
          { key: 'advancement', label: 'Advancement', icon: Star },
          ...(showDowntimeTab ? [{ key: 'downtime', label: 'Downtime', icon: Moon }] : []),
        ]}
      />

      {/* Tab Content */}
      <div className="space-y-6">
        {activeTab === 'overview' && (
          <div className="grid gap-6 md:grid-cols-2">
            {/* Prose fields — narrative content, no card chrome (see
                docs/design-system.md): these are meant to be read, not
                acted on. */}
            {character.description && (
              <div>
                <CardLabel>Description</CardLabel>
                <p className="leading-relaxed text-myth-ink-muted">{character.description}</p>
              </div>
            )}

            {character.appearance && (
              <div>
                <CardLabel>Appearance</CardLabel>
                <p className="leading-relaxed text-myth-ink-muted">{character.appearance}</p>
              </div>
            )}

            {character.personality && (
              <div>
                <CardLabel>Personality</CardLabel>
                <p className="leading-relaxed text-myth-ink-muted">{character.personality}</p>
              </div>
            )}

            {character.backstory && (
              <div>
                <CardLabel>Backstory</CardLabel>
                <p className="leading-relaxed text-myth-ink-muted">{character.backstory}</p>
              </div>
            )}

            {character.goals && (
              <div>
                <CardLabel>Goals</CardLabel>
                <p className="leading-relaxed text-myth-ink-muted">{character.goals}</p>
              </div>
            )}

            {/* Moves — displayed as "Abilities", a generic term that reads
                correctly regardless of universe (internal naming stays
                move-based; see pbta-moves.ts). Reference content — each
                has a name/trigger/description, not prose. */}
            {moves.length > 0 && (
              <Card>
                <CardLabel>Abilities</CardLabel>
                <div className="space-y-2">
                  {moves.map((move: any, idx: number) => (
                    <div key={idx} className="rounded-lg border border-myth-border bg-myth-surface-sunken p-3">
                      <div className="text-sm font-medium text-myth-ink">{move.name || move}</div>
                      {move.trigger && (
                        <div className="mt-1 text-xs italic text-myth-ink-faint">{move.trigger}</div>
                      )}
                      {move.description && (
                        <p className="mt-1 text-xs text-myth-ink-muted">{move.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="grid gap-6 md:grid-cols-2">
            {/* Harm Tracker */}
            <Card>
              <CardLabel>Health</CardLabel>
              <HarmTracker current={character.harm} max={6} />
            </Card>

            {/* Stats */}
            {statEntries.length > 0 && (
              <Card>
                <CardLabel>Stats</CardLabel>
                <div className="space-y-3">
                  {statEntries.map(([stat, value]) => {
                    const custom = (campaign?.statLabels as any)?.[stat]
                    return (
                      <StatBar
                        key={stat}
                        name={custom?.label || stat}
                        value={value as number}
                        description={custom?.description}
                      />
                    )
                  })}
                </div>
              </Card>
            )}

            {/* Conditions */}
            {conditionsList.length > 0 && (
              <Card>
                <CardLabel>Conditions</CardLabel>
                <div className="flex flex-wrap gap-2">
                  {conditionsList.map((cond: any, idx: number) => (
                    <span
                      key={idx}
                      className="rounded-full border border-myth-danger/30 bg-myth-danger/10 px-3 py-1 text-xs font-medium text-myth-danger"
                    >
                      {typeof cond === 'string' ? cond : cond.name}
                    </span>
                  ))}
                </div>
              </Card>
            )}

            {/* Resolved conditions — the historical record that a condition
                applied and later cleared, kept distinct from the current
                Conditions card above (#173). */}
            {conditionHistoryList.length > 0 && (
              <Card>
                <CardLabel>Past Conditions</CardLabel>
                <div className="flex flex-wrap gap-2">
                  {conditionHistoryList.map((entry: any, idx: number) => (
                    <span
                      key={idx}
                      className="rounded-full border border-myth-border bg-myth-surface-sunken px-3 py-1 text-xs font-medium text-myth-ink-faint"
                      title={entry.resolvedAt ? `Resolved turn ${entry.resolvedAt}` : undefined}
                    >
                      {entry.name}
                    </span>
                  ))}
                </div>
              </Card>
            )}

            {/* Perks */}
            {perksList.length > 0 && (
              <Card className="md:col-span-2">
                <CardLabel>Perks & Abilities</CardLabel>
                <div className="grid gap-3 md:grid-cols-2">
                  {perksList.map((perk: any, idx: number) => (
                    <div key={idx} className="rounded-lg border border-myth-border bg-myth-surface-sunken p-4">
                      <div className="mb-1 font-medium text-myth-ink">
                        {perk.name || perk}
                      </div>
                      {perk.description && (
                        <p className="text-xs text-myth-ink-muted">{perk.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Abilities & Knowledge — the knowledge-relative sheet. What
                renders here is what the character KNOWS: unlocked abilities
                show with a qualitative skill band, glimpsed ones as "???",
                and everything they've never encountered simply isn't here.
                Always shown (not just when non-empty) — an Outsider starts
                with a genuinely blank sheet by design, and without an
                explicit empty state that's indistinguishable from the
                feature being broken. */}
            {capabilitySummary && (
              <Card className="md:col-span-2">
                <CardLabel>Abilities & Knowledge</CardLabel>
                {capabilitySummary.known.length === 0 && capabilitySummary.glimpsed.length === 0 ? (
                  <p className="text-sm italic text-myth-ink-faint">
                    You haven't discovered anything about this world's systems yet — abilities and lore will appear here as the story reveals them.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {capabilityDomains.map(domain => (
                      <div key={domain}>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-myth-ink-faint">{domain}</div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {capabilitySummary.known
                            .filter((k: any) => k.domain === domain)
                            .map((k: any, idx: number) => (
                              <div key={`k-${idx}`} className="rounded-lg border border-myth-border bg-myth-surface-sunken p-4">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <span className="font-medium text-myth-ink">{k.name}</span>
                                  <span className="whitespace-nowrap rounded-full bg-myth-ink/5 px-2 py-0.5 text-xs capitalize text-myth-ink-faint">{k.band}</span>
                                </div>
                                {k.description && (
                                  <p className="text-xs text-myth-ink-muted">{k.description}</p>
                                )}
                              </div>
                            ))}
                          {capabilitySummary.glimpsed
                            .filter((g: any) => g.domain === domain)
                            .map((g: any, idx: number) => (
                              <div key={`g-${idx}`} className="rounded-lg border border-dashed border-myth-border p-4">
                                <div className="mb-1 font-medium text-myth-ink-faint">???</div>
                                <p className="text-xs italic text-myth-ink-faint">
                                  {g.hint || 'You know something like this exists… but not what it is.'}
                                </p>
                              </div>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {/* Known Facts — structured, permanent declarative knowledge
                (#173/#174), distinct from Abilities & Knowledge above
                (system existence + proficiency, not standalone facts). */}
            {knownConcepts.length > 0 && (
              <Card className="md:col-span-2">
                <CardLabel>Known Facts</CardLabel>
                <div className="flex flex-wrap gap-2">
                  {knownConcepts.map((concept: any, idx: number) => (
                    <span
                      key={idx}
                      className="rounded-full border border-myth-border bg-myth-surface-sunken px-3 py-1 text-xs font-medium text-myth-ink-muted"
                      title={concept.source || undefined}
                    >
                      {concept.label}
                    </span>
                  ))}
                </div>
              </Card>
            )}

            {/* Reputation — faction standing in the fiction's own language:
                how each faction's people treat you, never a number. */}
            {standingSummary.length > 0 && (
              <Card className="md:col-span-2">
                <CardLabel>Reputation</CardLabel>
                <div className="flex flex-wrap gap-2">
                  {standingSummary.map((s, idx) => (
                    <span
                      key={idx}
                      className={`text-sm px-3 py-1.5 rounded-full border ${
                        s.label.startsWith('hunted') || s.label.startsWith('hostile') || s.label.startsWith('distrusted')
                          ? 'border-myth-danger/30 bg-myth-danger/10 text-myth-danger'
                          : 'border-myth-border bg-myth-surface-sunken text-myth-ink-muted'
                      }`}
                    >
                      {s.label.charAt(0).toUpperCase() + s.label.slice(1)} <span className="font-medium">{s.faction}</span>
                    </span>
                  ))}
                </div>
              </Card>
            )}

            {/* Corruption — only in universes whose fiction has a
                power-at-a-cost concept, and only once this character has
                actually marked it. Staged prose + subtle marks, never
                "3/5" — and never shown at zero: an untouched character
                shouldn't be advertised a mechanic they haven't met. */}
            {corruptionTheme && corruptionValue > 0 && (
              <Card className="md:col-span-2 border-myth-danger/30">
                <div className="mb-2 flex items-center justify-between">
                  <CardLabel className="mb-0 text-myth-danger">{corruptionTheme.name}</CardLabel>
                  <span className="tracking-widest text-myth-danger" aria-label="corruption marks">
                    {'●'.repeat(Math.min(corruptionValue, MAX_CORRUPTION))}
                    {'○'.repeat(Math.max(0, MAX_CORRUPTION - corruptionValue))}
                  </span>
                </div>
                {corruptionStageText && (
                  <p className="text-sm italic text-myth-danger">{corruptionStageText}</p>
                )}
              </Card>
            )}

            {/* Obligations — the Debt economy, in the fiction's own
                language: who considers whom in whose debt, never a
                ledger counter. */}
            {hasDebts && (
              <Card className="md:col-span-2">
                <CardLabel>Obligations</CardLabel>
                <div className="grid gap-3 md:grid-cols-2">
                  {debtSummary!.owedByCharacter.map((d, idx) => (
                    <div key={`ob-${idx}`} className="rounded-lg border border-myth-border bg-myth-surface-sunken p-4">
                      <div className="mb-1 font-medium text-myth-ink">
                        {d.counterparty} considers you in their debt
                      </div>
                      <p className="text-xs text-myth-ink-muted">{d.description}</p>
                    </div>
                  ))}
                  {debtSummary!.owedToCharacter.map((d, idx) => (
                    <div key={`ot-${idx}`} className="rounded-lg border border-myth-border bg-myth-surface-sunken p-4">
                      <div className="mb-1 font-medium text-myth-ink">
                        {d.counterparty} owes you
                      </div>
                      <p className="text-xs text-myth-ink-muted">{d.description}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Consequences */}
            {allConsequences.length > 0 && (
              <Card className="md:col-span-2">
                <CardLabel>Consequences</CardLabel>
                <div className="grid gap-3 md:grid-cols-2">
                  {allConsequences.map((cons, idx) => (
                    <ConsequenceBadge key={idx} type={cons.type} description={cons.description} />
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {activeTab === 'inventory' && (
          <div className="grid gap-6 md:grid-cols-2">
            {/* Equipment */}
            {(equipment.weapon || equipment.armor || equipment.misc) && (
              <Card>
                <CardLabel>Equipped</CardLabel>
                <div className="space-y-3">
                  {equipment.weapon && (
                    <div className="rounded-lg border border-myth-border bg-myth-surface-sunken p-3">
                      <span className="mb-1 block text-xs text-myth-ink-faint">Weapon</span>
                      <p className="font-medium text-myth-ink">
                        {typeof equipment.weapon === 'string' ? equipment.weapon : equipment.weapon.name}
                      </p>
                      {equipment.weapon.description && (
                        <p className="mt-1 text-xs text-myth-ink-muted">{equipment.weapon.description}</p>
                      )}
                    </div>
                  )}
                  {equipment.armor && (
                    <div className="rounded-lg border border-myth-border bg-myth-surface-sunken p-3">
                      <span className="mb-1 block text-xs text-myth-ink-faint">Armor</span>
                      <p className="font-medium text-myth-ink">
                        {typeof equipment.armor === 'string' ? equipment.armor : equipment.armor.name}
                      </p>
                      {equipment.armor.description && (
                        <p className="mt-1 text-xs text-myth-ink-muted">{equipment.armor.description}</p>
                      )}
                    </div>
                  )}
                  {equipment.misc && (
                    <div className="rounded-lg border border-myth-border bg-myth-surface-sunken p-3">
                      <span className="mb-1 block text-xs text-myth-ink-faint">Misc</span>
                      <p className="font-medium text-myth-ink">
                        {typeof equipment.misc === 'string' ? equipment.misc : equipment.misc.name}
                      </p>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Inventory Items */}
            {items.length > 0 && (
              <Card>
                <CardLabel>Inventory</CardLabel>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((item: any, idx: number) => (
                    <div key={idx} className="rounded-lg border border-myth-border bg-myth-surface-sunken p-3 transition-colors hover:border-myth-border-strong">
                      <div className="text-sm font-medium text-myth-ink">
                        {typeof item === 'string' ? item : item.name}
                      </div>
                      {item.quantity && (
                        <div className="text-xs text-myth-ink-faint">×{item.quantity}</div>
                      )}
                      {item.description && (
                        <div className="mt-1 text-xs text-myth-ink-muted">{item.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Resources */}
            {(resources.gold !== undefined || resources.contacts?.length > 0 || Object.keys(resources).length > 0) && (
              <Card className="md:col-span-2">
                <CardLabel>Resources</CardLabel>
                <div className="grid gap-3 md:grid-cols-3">
                  {resources.gold !== undefined && (
                    <div className="rounded-lg border border-myth-border bg-myth-surface-sunken p-4">
                      <span className="mb-1 block text-sm capitalize text-myth-ink-muted">
                        {resources.gold === 1 ? currency.singular : currency.plural}
                      </span>
                      <span className="text-2xl font-bold text-myth-ink">
                        <currency.icon className="mr-1 inline h-4 w-4 align-[-0.15em]" />
                        {resources.gold}
                      </span>
                    </div>
                  )}
                  {Object.entries(resources)
                    .filter(([key]) => key !== 'gold' && key !== 'contacts')
                    .map(([key, value]) => (
                      <div key={key} className="rounded-lg border border-myth-border bg-myth-surface-sunken p-4">
                        <span className="mb-1 block text-sm capitalize text-myth-ink-muted">{key.replace(/_/g, ' ')}</span>
                        <span className="text-xl font-bold text-myth-ink">
                          {typeof value === 'object' && value !== null ? (
                            // Handle reputation objects specially
                            key.toLowerCase().includes('reputation') ? (
                              <div className="space-y-1 text-sm">
                                {Object.entries(value as Record<string, number>).map(([faction, rep]) => (
                                  <div key={faction} className="flex items-center justify-between">
                                    <span className="text-myth-ink-muted">{faction}:</span>
                                    <span className={rep > 0 ? 'text-myth-good' : rep < 0 ? 'text-myth-danger' : 'text-myth-ink-muted'}>
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
                    <div className="rounded-lg border border-myth-border bg-myth-surface-sunken p-4 md:col-span-3">
                      <span className="mb-2 block text-sm text-myth-ink-muted">Contacts</span>
                      <div className="flex flex-wrap gap-2">
                        {resources.contacts.map((contact: string, idx: number) => (
                          <Link
                            key={idx}
                            href={`/campaigns/${campaignId}/world?type=NPC&search=${encodeURIComponent(contact)}`}
                            className="cursor-pointer rounded-full border border-myth-border bg-myth-surface px-3 py-1 text-xs text-myth-ink-muted transition-colors hover:border-myth-border-strong hover:text-myth-ink"
                            title={`View ${contact} in wiki`}
                          >
                            {contact}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {!equipment.weapon && !equipment.armor && items.length === 0 && Object.keys(resources).length === 0 && (
              <Card className="md:col-span-2">
                <div className="py-8 text-center text-myth-ink-faint">
                  <Backpack className="mx-auto mb-2 h-8 w-8 text-myth-ink-faint" />
                  <p className="text-sm">No items or equipment</p>
                  <p className="mt-1 text-xs">Your inventory is empty</p>
                </div>
              </Card>
            )}

            {/* #416: where gold actually goes. The economy modelled earning,
                owing and defaulting and had no modelled way to spend, so
                gold accumulated and only ever left through an AI-narrated
                delta. Fetches its own prices — see SpendPanel. */}
            {campaignId && character?.id && (
              <Card className="md:col-span-2">
                <CardLabel>Spend</CardLabel>
                <SpendPanel
                  campaignId={campaignId}
                  characterId={character.id}
                  currencyPlural={currency.plural}
                />
              </Card>
            )}
          </div>
        )}

        {activeTab === 'relationships' && (
          <div className="space-y-6">
            <Card className="bg-myth-surface-sunken">
              <p className="text-sm italic text-myth-ink-muted">
                The promises, debts, enemies and lasting threats your choices have created. These accumulate through
                play — how any given NPC privately regards you is something you'll have to read from how they treat
                you in the fiction.
              </p>
            </Card>

            {allConsequences.filter(c => c.type === 'enemy').length > 0 && (
              <Card>
                <CardLabel className="text-myth-danger">Enemies</CardLabel>
                <div className="space-y-3">
                  {allConsequences
                    .filter(c => c.type === 'enemy')
                    .map((cons, idx) => (
                      <div key={idx} className="rounded-lg border border-myth-danger/30 bg-myth-danger/10 p-4">
                        <p className="text-sm text-myth-danger">{cons.description}</p>
                      </div>
                    ))}
                </div>
              </Card>
            )}

            {allConsequences.filter(c => c.type === 'promise').length > 0 && (
              <Card>
                <CardLabel>Promises</CardLabel>
                <div className="space-y-3">
                  {allConsequences
                    .filter(c => c.type === 'promise')
                    .map((cons, idx) => (
                      <div key={idx} className="rounded-lg border border-myth-border bg-myth-surface-sunken p-4">
                        <p className="text-sm text-myth-ink-muted">{cons.description}</p>
                      </div>
                    ))}
                </div>
              </Card>
            )}

            {allConsequences.filter(c => c.type === 'debt').length > 0 && (
              <Card>
                <CardLabel>Debts</CardLabel>
                <div className="space-y-3">
                  {allConsequences
                    .filter(c => c.type === 'debt')
                    .map((cons, idx) => (
                      <div key={idx} className="rounded-lg border border-myth-warn/30 bg-myth-warn/10 p-4">
                        <p className="text-sm text-myth-warn">{cons.description}</p>
                      </div>
                    ))}
                </div>
              </Card>
            )}

            {allConsequences.filter(c => c.type === 'longTermThreat').length > 0 && (
              <Card>
                <CardLabel className="text-myth-danger">Long-Term Threats</CardLabel>
                <div className="space-y-3">
                  {allConsequences
                    .filter(c => c.type === 'longTermThreat')
                    .map((cons, idx) => (
                      <div key={idx} className="rounded-lg border border-myth-danger/20 bg-myth-danger/10 p-4">
                        <p className="text-sm text-myth-danger">{cons.description}</p>
                      </div>
                    ))}
                </div>
              </Card>
            )}

            {allConsequences.length === 0 && (
              <Card>
                <div className="py-12 text-center text-myth-ink-faint">
                  <Sparkles className="mx-auto mb-4 h-12 w-12 text-myth-ink-faint" />
                  <p className="mb-1 text-lg">No lasting ties yet</p>
                  <p className="text-sm">Your actions will shape these over time</p>
                </div>
              </Card>
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
                <div className="rounded-lg border border-myth-border p-4 text-center">
                  <div className="text-2xl font-bold text-myth-ink">{advLog.totalStatIncreases || 0}</div>
                  <div className="mt-1 text-xs uppercase tracking-wide text-myth-ink-faint">Stat Increases</div>
                </div>
                <div className="rounded-lg border border-myth-border p-4 text-center">
                  <div className="text-2xl font-bold text-myth-good">{advLog.totalPerksGained || 0}</div>
                  <div className="mt-1 text-xs uppercase tracking-wide text-myth-ink-faint">Perks Gained</div>
                </div>
                <div className="rounded-lg border border-myth-border p-4 text-center">
                  <div className="text-2xl font-bold text-myth-ink">{advLog.totalMovesLearned || 0}</div>
                  <div className="mt-1 text-xs uppercase tracking-wide text-myth-ink-faint">Abilities Learned</div>
                </div>
              </div>

              {/* History */}
              <Card>
                <SectionHeader as="h3" title="Growth History" />
                <div className="mt-4">
                {entries.length === 0 ? (
                  <div className="py-8 text-center text-myth-ink-faint">
                    <Sprout className="mx-auto mb-3 h-8 w-8 text-myth-ink-faint" />
                    <p>No advancements yet</p>
                    <p className="mt-1 text-sm">Keep playing — your character grows organically through action</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {[...entries].reverse().map((entry: any, idx: number) => {
                      const date = new Date(entry.timestamp).toLocaleDateString()
                      const turnInfo = entry.turnNumber ? ` · Turn ${entry.turnNumber}` : ''
                      let Icon: IconComponent = Star
                      let color = 'text-myth-ink-muted'
                      let label = ''
                      if (entry.type === 'stat_increase') {
                        Icon = TrendingUp
                        color = 'text-myth-ink'
                        label = `${entry.details.statKey} ${entry.details.oldValue} → ${entry.details.newValue}`
                      } else if (entry.type === 'perk_gained') {
                        Icon = Sparkles
                        color = 'text-myth-good'
                        label = entry.details.perkName || entry.details.perkId
                      } else if (entry.type === 'move_learned') {
                        Icon = Target
                        color = 'text-myth-ink'
                        label = entry.details.moveId
                      }
                      return (
                        <div key={idx} className="flex items-start gap-3 rounded-lg border border-myth-border bg-myth-surface-sunken p-3">
                          <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className={`text-sm font-medium ${color}`}>{label}</div>
                            <div className="mt-0.5 text-xs text-myth-ink-faint">{entry.details.reason}</div>
                          </div>
                          <div className="whitespace-nowrap text-xs text-myth-ink-faint">{date}{turnInfo}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
                </div>
              </Card>
            </div>
          )
        })()}

        {activeTab === 'downtime' && showDowntimeTab && (
          <DynamicDowntimeManager
            activities={downtimeActivities || []}
            characterId={character.id}
            characterGold={(character.resources as any)?.gold || 0}
            characterName={character.name || ''}
            onCreateActivity={onCreateDowntimeActivity}
            onAdvanceTime={onAdvanceDowntimeTime}
            onRespondToEvent={onRespondToDowntimeEvent}
            suggestions={downtimeSuggestions}
          />
        )}
      </div>
    </div>
  )
}
