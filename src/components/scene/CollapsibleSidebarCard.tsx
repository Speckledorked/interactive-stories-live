// src/components/scene/CollapsibleSidebarCard.tsx
// Shared chrome for the story page's sidebar panels (map/clocks/timeline/
// etc): a bordered card with a header row and a Hide/Show toggle,
// generalized from MapViewerPanel's original hand-rolled version (the
// only one of these panels that already had this affordance). Collapsing
// by default on the panels that aren't needed moment-to-moment is the
// main lever against the story page reading as "incredibly long,"
// especially on mobile where the whole sidebar stacks below the scene
// instead of beside it.

'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface CollapsibleSidebarCardProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}

export function CollapsibleSidebarCard({ title, defaultOpen = true, children }: CollapsibleSidebarCardProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium uppercase tracking-wide text-myth-ink-faint">{title}</h3>
        <Button
          variant="ghost" size="sm"
          onClick={() => setOpen(!open)}
        >
          {open ? 'Hide' : 'Show'}
        </Button>
      </div>
      {open && children}
    </div>
  )
}
