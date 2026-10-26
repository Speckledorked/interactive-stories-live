// src/components/scene/WorldPulsePanel.tsx
//
// #523 — what moved while you have been in this scene.
//
// The sidebar already carries ACTIVE THREADS and the recent timeline;
// neither answers "did anything happen out there just now". The away
// letter does, for an absence, and AITransparencyPanel does for the
// player's own action. This is the gap between them.
//
// Self-fetching, like every other panel here that needs something the
// story page's own payload does not carry. The window is the scene's, so
// the answer changes when the scene does rather than when a prop does.
//
// Renders nothing when nothing moved, which is the common case inside a
// single scene. An always-present "WHILE YOU HAVE BEEN HERE" header over
// "nothing yet" would be a panel that is usually noise.

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CollapsibleSidebarCard } from '@/components/scene/CollapsibleSidebarCard'
import { authenticatedFetch } from '@/lib/clientAuth'

interface PulseEntry {
  id: string
  category: string
  categoryLabel: string
  line: string
}

interface WorldPulsePanelProps {
  campaignId: string
  /** Refetches when this changes, so a new scene starts a new window. */
  sceneId: string | null | undefined
}

export function WorldPulsePanel({ campaignId, sceneId }: WorldPulsePanelProps) {
  const [entries, setEntries] = useState<PulseEntry[]>([])
  const [totalEvents, setTotalEvents] = useState(0)

  // Which scene the newest request is for. Same whichever-settles-last
  // race EntityBrowser documents: when one scene resolves and the next
  // begins, a slow response for the old window must not land on top of
  // the new one and report movement from before the player sat down.
  const latestRequest = useRef<string | null>(null)

  const load = useCallback(async () => {
    latestRequest.current = sceneId ?? null
    // No scene, no window — the route says the same thing, and asking
    // anyway would be a request whose answer is known.
    if (!sceneId) {
      setEntries([])
      setTotalEvents(0)
      return
    }
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/world-pulse`)
      if (latestRequest.current !== sceneId) return
      if (!response.ok) return
      const data = await response.json()
      if (latestRequest.current !== sceneId) return
      setEntries(data.entries ?? [])
      setTotalEvents(data.totalEvents ?? 0)
    } catch {
      // Silent: a supplementary panel should not put an error on a page
      // whose actual job is running the scene.
    }
  }, [campaignId, sceneId])

  useEffect(() => {
    load()
  }, [load])

  if (entries.length === 0) return null

  // totalEvents is the real count over the window, measured rather than
  // inferred (#445), so it can exceed what is shown.
  const unshown = totalEvents - entries.length

  return (
    <CollapsibleSidebarCard title="WHILE YOU'VE BEEN HERE">
      <ul className="space-y-2.5">
        {entries.map((entry) => (
          <li key={entry.id}>
            <p className="font-mono text-[10px] uppercase tracking-wider text-myth-ink-faint">
              {entry.categoryLabel}
            </p>
            <p className="text-sm leading-relaxed text-myth-ink-muted">{entry.line}</p>
          </li>
        ))}
      </ul>
      {unshown > 0 && (
        <p className="mt-3 text-xs text-myth-ink-faint">
          and {unshown} more {unshown === 1 ? 'change' : 'changes'} besides
        </p>
      )}
    </CollapsibleSidebarCard>
  )
}
