'use client'

import { useState } from 'react'
import Link from 'next/link'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'

interface RosterCharacter {
  id: string
  name: string
  concept?: string
  currentLocation?: string
  isAlive: boolean
  conditions?: string[]
  userId: string
  user: { name?: string | null; email: string }
}

// Merges the old "Your Characters" + "All Characters" sections. Ownership
// shows as a small "Played by you" tag on the owner's own card(s) rather
// than a second section. The All/Yours filter only appears once there's
// enough roster to justify it.
export function CharacterRoster({
  characters,
  currentUserId,
  campaignId,
  activePlayerCount,
  onCreateCharacter,
  onDeleteCharacter,
}: {
  characters: RosterCharacter[]
  currentUserId: string | undefined
  campaignId: string
  activePlayerCount: number
  onCreateCharacter: () => void
  onDeleteCharacter: (characterId: string) => void
}) {
  const [filter, setFilter] = useState<'all' | 'yours'>('all')

  const showFilter = characters.length > 6 && activePlayerCount > 1
  const visibleCharacters =
    showFilter && filter === 'yours' ? characters.filter((c) => c.userId === currentUserId) : characters

  return (
    <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-myth-ink">Characters</h2>
        <div className="flex items-center gap-3">
          {showFilter && (
            <Tabs
              variant="pill"
              aria-label="Filter characters"
              value={filter}
              onChange={(v) => setFilter(v as typeof filter)}
              className="capitalize"
              items={[
                { key: 'all', label: 'All' },
                { key: 'yours', label: 'Yours' },
              ]}
            />
          )}
          <Button variant="ghost" size="sm" className="-mr-3" type="button" onClick={onCreateCharacter}>
            + Create Character
          </Button>
        </div>
      </div>

      {characters.length === 0 ? (
        <EmptyState
          title="No characters yet"
          description="Create the first character to start playing in this campaign."
          action={{ label: 'Create Character', onClick: onCreateCharacter }}
        />
      ) : (
        <div className="space-y-2">
          {visibleCharacters.map((character) => {
            const isMine = character.userId === currentUserId
            return (
              <Link
                key={character.id}
                href={`/campaigns/${campaignId}/characters/${character.id}`}
                className="group flex items-start justify-between gap-3 rounded-md border border-transparent p-3 transition-colors hover:border-myth-border hover:bg-myth-surface-sunken"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-myth-ink">{character.name}</span>
                    {isMine && (
                      <span className="rounded border border-myth-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-myth-ink-muted">
                        Played by you
                      </span>
                    )}
                    {!isMine && (
                      <span className="text-xs text-myth-ink-faint">{character.user.name || character.user.email}</span>
                    )}
                  </div>
                  {character.concept && <p className="mt-0.5 text-sm text-myth-ink-muted">{character.concept}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {character.currentLocation && (
                      <span className="text-xs text-myth-ink-faint">{character.currentLocation}</span>
                    )}
                    {Array.isArray(character.conditions) &&
                      character.conditions.map((condition, i) => (
                        <span
                          key={i}
                          className="rounded bg-myth-danger/10 px-1.5 py-0.5 text-xs text-myth-danger"
                        >
                          {condition}
                        </span>
                      ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`text-xs ${character.isAlive ? 'text-myth-good' : 'text-myth-ink-faint'}`}>
                    {character.isAlive ? 'Alive' : 'Dead'}
                  </span>
                  {isMine && (
                    <Button
                      variant="ghost" size="sm" className="opacity-0 hover:text-myth-danger group-hover:opacity-100"
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onDeleteCharacter(character.id)
                      }}
                      title="Delete character"
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
