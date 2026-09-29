// src/components/scene/CharacterSelectorPanel.tsx
// The story page sidebar's character picker + quick-glance card. Split out
// of story/page.tsx's ~1700-line body, which already read as several
// self-contained sidebar panels separated only by comments — this is one
// of them, moved verbatim (same markup, same classes, same conditions).

'use client'

import Link from 'next/link'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { MapPin, UserPlus } from 'lucide-react'

interface CharacterSelectorPanelProps {
  userCharacters: any[]
  selectedCharacterId: string
  onSelectCharacter: (characterId: string) => void
  selectedCharacter: any
  onShowSnapshot: () => void
  /** Needed for the no-characters CTA below. */
  campaignId: string
}

export function CharacterSelectorPanel({
  userCharacters,
  selectedCharacterId,
  onSelectCharacter,
  selectedCharacter,
  onShowSnapshot,
  campaignId,
}: CharacterSelectorPanelProps) {
  // #495: this used to `return null`, and the story page is reachable in one
  // tap from the mobile bottom bar. So a first-time player on a phone tapped
  // Story, saw scenes, could even start one — and then found no way to act,
  // because every action control is gated on selectedCharacterId and the
  // only thing that could set it had rendered nothing at all. A blank space
  // does not read as "you need a character"; it reads as a broken page.
  //
  // The gate is right. Silence was the bug.
  if (userCharacters.length === 0) {
    return (
      <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
        <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-myth-ink-faint">
          No character yet
        </h3>
        <p className="mb-4 text-sm text-myth-ink-muted">
          You can read the story without one. To act in a scene, you need someone to act as.
        </p>
        <Link
          href={`/campaigns/${campaignId}?create=character`}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-myth-accent px-4 text-sm font-medium text-myth-accent-ink transition-colors hover:bg-myth-accent-hover touch-manipulation"
        >
          <UserPlus className="h-4 w-4" />
          Create a character
        </Link>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
      <h3 className="text-sm font-medium uppercase tracking-wide text-myth-ink-faint mb-3">SELECT CHARACTER</h3>
      <Select
        wrapperClassName="w-full"
        value={selectedCharacterId}
        onChange={(e) => onSelectCharacter(e.target.value)}
      >
        <option value="">Choose a character...</option>
        {userCharacters.map(char => (
          <option key={char.id} value={char.id}>
            {char.name}
          </option>
        ))}
      </Select>
      {selectedCharacter && (
        <div className="mt-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <h4 className="font-display text-myth-ink text-lg">{selectedCharacter.name}</h4>
              <p className="text-sm text-myth-ink-muted">{selectedCharacter.concept}</p>
            </div>
            <Button
              size="sm"
              onClick={onShowSnapshot}
              title="Quick Reference"
            >
              View
            </Button>
          </div>
          {selectedCharacter.currentLocation && (
            <p className="text-xs text-myth-ink-faint">
              <MapPin className="mr-1 inline h-3.5 w-3.5 align-[-0.15em]" />{selectedCharacter.currentLocation}
            </p>
          )}
          {Array.isArray(selectedCharacter.conditions) &&
            selectedCharacter.conditions.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-myth-ink-faint mb-1">Conditions:</p>
                <div className="flex flex-wrap gap-1">
                  {selectedCharacter.conditions.map((cond: string, i: number) => (
                    <span
                      key={i}
                      className="px-2 py-1 bg-myth-danger/10 text-myth-danger rounded text-xs"
                    >
                      {cond}
                    </span>
                  ))}
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  )
}
