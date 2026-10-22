// src/components/character/CharacterKnowledgePanel.tsx
//
// #520 — what this character knows, and how they came to know it.
//
// Fetches on its own rather than taking the data as a prop. The character
// sheet's payload is readable by any campaign member (see the GET in
// api/campaigns/[id]/characters/[characterId]/route.ts); knowledge is
// owner-scoped, and threading an owner-only field through a shared prop is
// how a leak gets introduced later by someone reusing the sheet elsewhere.
// Its own fetch against its own gated route keeps the two separate.
//
// Renders nothing at all when both lists are empty. A brand-new character
// has witnessed nothing, and an empty "What you know" card reads as a
// broken feature rather than an honest "not yet".

'use client'

import { useCallback, useEffect, useState } from 'react'
import { Ear, Eye } from 'lucide-react'
import { authenticatedFetch } from '@/lib/clientAuth'
import type { KnownEvent } from '@/lib/game/characterKnowledge'

interface Props {
  campaignId: string
  characterId: string
}

export default function CharacterKnowledgePanel({ campaignId, characterId }: Props) {
  const [firsthand, setFirsthand] = useState<KnownEvent[]>([])
  const [secondhand, setSecondhand] = useState<KnownEvent[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await authenticatedFetch(
        `/api/campaigns/${campaignId}/characters/${characterId}/knowledge`
      )
      // A 403 here is the ordinary case for someone else's character, not
      // an error worth showing: the panel simply has nothing to say.
      if (!response.ok) return
      const data = await response.json()
      setFirsthand(data.firsthand ?? [])
      setSecondhand(data.secondhand ?? [])
    } catch {
      // Silent: this is a supplementary panel, and a failed fetch should
      // not put an error banner on an otherwise working character sheet.
    } finally {
      setLoaded(true)
    }
  }, [campaignId, characterId])

  useEffect(() => {
    load()
  }, [load])

  if (!loaded || (firsthand.length === 0 && secondhand.length === 0)) return null

  return (
    <section className="mt-6 rounded-lg border border-myth-border bg-myth-surface p-5">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-myth-ink-faint">
        What you know
      </h2>
      <p className="mb-5 text-sm text-myth-ink-muted">
        Word reaches you by how near you were, and by who you know. Some of it is late, and some of
        it is wrong.
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <KnowledgeList
          icon={Eye}
          title="You were there"
          entries={firsthand}
          emptyNote="You have not yet been present for anything the world remembers."
        />
        <KnowledgeList
          icon={Ear}
          title="You have heard"
          entries={secondhand}
          emptyNote="Nothing has reached you secondhand."
        />
      </div>
    </section>
  )
}

function KnowledgeList({
  icon: Icon,
  title,
  entries,
  emptyNote,
}: {
  icon: typeof Eye
  title: string
  entries: KnownEvent[]
  emptyNote: string
}) {
  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-myth-ink">
        <Icon className="h-4 w-4 text-myth-accent" />
        {title}
      </h3>
      {entries.length === 0 ? (
        <p className="text-sm text-myth-ink-faint">{emptyNote}</p>
      ) : (
        <ul className="space-y-2.5">
          {entries.map((entry, idx) => (
            <li key={idx} className="text-sm leading-relaxed text-myth-ink-muted">
              {entry.text}
              {/* Deliberately vague. The server sends only whether the
                  account smells off, never which way it has been bent —
                  "sounds exaggerated" would tell the player the truth is
                  smaller, which is part of the answer. */}
              {entry.doubtful && (
                <span className="ml-1 text-xs italic text-myth-ink-faint">
                  — though something about the telling does not sit right
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
