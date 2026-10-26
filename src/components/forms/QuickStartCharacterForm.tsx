// src/components/forms/QuickStartCharacterForm.tsx
//
// #508 — a character in one step.
//
// The full wizard is six tabs and a submit button that only appears on the
// sixth, behind a deliberate grace period (see
// EnhancedCreateCharacterForm's SUBMIT_GRACE_PERIOD_MS). That is the right
// shape for someone building a character they care about, and the wrong
// first thing to show a stranger who has just taken a copy of a world and
// wants to find out whether any of this is for them. Three of the six
// campaigns real strangers started never got a character at all.
//
// So: a name, an archetype, and begin. Everything the wizard would have
// collected is either filled from the archetype card, generated
// server-side from archetypeId (capability glimpses, the starting tie), or
// editable afterwards — the server has only ever required a name.
//
// The wizard is NOT replaced, and is one click away. Someone who wants to
// write a backstory before their first scene should be able to, and this
// is explicitly the quick path rather than the new only path.
//
// What this does not defer is stats. They are not in
// PLAYER_EDITABLE_FIELDS, so a character created without them cannot be
// given them later except by an admin — which is why an archetype that
// carries none is not offered here (isQuickStartable) and why a campaign
// whose generation produced no usable cards falls through to the wizard
// instead of quietly creating a statless character.

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SpinnerBlock } from '@/components/ui/spinner'
import { authenticatedFetch } from '@/lib/clientAuth'
import {
  archetypeLoadout,
  isQuickStartable,
  type ArchetypeCard,
} from '@/lib/game/archetypeLoadout'

interface Props {
  campaignId: string
  onSuccess?: () => void
  onCancel?: () => void
  /** Switch to the full wizard. Rendered as a plain link, not a warning. */
  onWantsFullForm: () => void
  /**
   * Called when this path cannot work for this campaign — no archetype
   * carries stats. The parent shows the wizard instead of this component
   * showing an apology for a choice the player did not make.
   */
  onUnavailable: () => void
}

export default function QuickStartCharacterForm({
  campaignId,
  onSuccess,
  onCancel,
  onWantsFullForm,
  onUnavailable,
}: Props) {
  const router = useRouter()
  const [archetypes, setArchetypes] = useState<ArchetypeCard[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Where the rest of the party is. The wizard collects this for a stated
  // reason — nothing otherwise keeps a new character's starting location
  // in sync, "which is how a party ends up accidentally split with no one
  // having chosen that on purpose" — so the quick path must not drop it.
  // A single shared location is used; a genuine split is left blank
  // rather than guessed at.
  const partyLocation = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    Promise.all([
      authenticatedFetch(`/api/campaigns/${campaignId}/archetypes`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
      authenticatedFetch(`/api/campaigns/${campaignId}`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
    ]).then(([extras, campaign]) => {
      if (cancelled) return

      const locations = [
        ...new Set(
          ((campaign?.campaign?.characters ?? []) as Array<{ currentLocation?: string }>)
            .map((c) => (c.currentLocation || '').trim())
            .filter(Boolean)
        ),
      ]
      partyLocation.current = locations.length === 1 ? locations[0] : null

      const usable = ((extras?.archetypes ?? []) as ArchetypeCard[]).filter(isQuickStartable)
      setArchetypes(usable)
      setLoading(false)
      // No usable card means no one-step path. Hand over rather than
      // render an empty chooser.
      if (usable.length === 0) onUnavailable()
    })

    return () => {
      cancelled = true
    }
  }, [campaignId, onUnavailable])

  const submit = useCallback(async () => {
    const card = archetypes.find((a) => a.id === chosenId)
    if (!card || !name.trim()) return

    setSubmitting(true)
    setError('')
    const loadout = archetypeLoadout(card)

    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/characters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          // The server seeds capability glimpses and the starting tie from
          // this, so it is not merely a record of what was picked.
          archetypeId: card.id,
          originFamiliarity: loadout.originFamiliarity,
          stats: loadout.stats,
          ...(loadout.equipment ? { equipment: loadout.equipment } : {}),
          ...(loadout.items
            ? {
                inventory: {
                  items: loadout.items.map((item, idx) => ({
                    id: `archetype-${idx}-${Date.now()}`,
                    name: item.name,
                    quantity: item.quantity,
                    tags: item.tags,
                  })),
                },
              }
            : {}),
          ...(partyLocation.current ? { currentLocation: partyLocation.current } : {}),
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || 'That character could not be created.')
      }

      onSuccess?.()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That character could not be created.')
      setSubmitting(false)
    }
  }, [archetypes, chosenId, name, campaignId, onSuccess, router])

  if (loading) return <SpinnerBlock />
  if (archetypes.length === 0) return null

  return (
    <div>
      <p className="mb-5 text-sm leading-relaxed text-myth-ink-muted">
        Pick who you are and give them a name. You can fill in the rest — how they look, where they
        came from, what they want — once you have played a scene and know them a little.
      </p>

      <div className="mb-5">
        <Label htmlFor="quick-start-name">Name</Label>
        <Input
          id="quick-start-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What are they called?"
          maxLength={100}
        />
      </div>

      <div className="mb-6 space-y-2">
        <Label>Who are they?</Label>
        {archetypes.map((card) => {
          const chosen = card.id === chosenId
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => setChosenId(card.id)}
              aria-pressed={chosen}
              className={`w-full rounded-lg border p-4 text-left transition-colors ${
                chosen
                  ? 'border-myth-accent bg-myth-accent/10'
                  : 'border-myth-border bg-myth-surface-sunken hover:border-myth-ink-faint'
              }`}
            >
              <p className="text-sm font-semibold text-myth-ink">{card.name}</p>
              <p className="mt-1 text-sm leading-relaxed text-myth-ink-muted">{card.description}</p>
            </button>
          )
        })}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-myth-danger/30 bg-myth-danger/10 p-3">
          <p className="text-sm text-myth-danger">{error}</p>
        </div>
      )}

      <Button
        size="lg"
        fullWidth
        onClick={submit}
        disabled={submitting || !chosenId || name.trim() === ''}
      >
        {submitting ? (
          'Beginning…'
        ) : (
          <>
            <Sparkles className="h-5 w-5" /> Begin
          </>
        )}
      </Button>

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onWantsFullForm}
          className="min-h-[44px] text-sm text-myth-ink-faint hover:text-myth-ink hover:underline"
        >
          Build them in detail instead
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[44px] text-sm text-myth-ink-faint hover:text-myth-ink hover:underline"
          >
            Not now
          </button>
        )}
      </div>
    </div>
  )
}
