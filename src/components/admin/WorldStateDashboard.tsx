// src/components/admin/WorldStateDashboard.tsx
// Overview's "World Summary" section: a quiet read of the world's current
// state (NPCs, factions, clocks, notes) — flat surfaces, no iconography
// beyond plain functional wayfinding icons, semantic color only.

'use client'

import { Users, Landmark, Clock as ClockIcon, StickyNote } from 'lucide-react'
import { CompactClock } from '@/components/clock/ClockProgress'

interface NPC {
  id: string
  name: string
  role: string
  status: 'alive' | 'dead' | 'unknown'
  relationship?: 'friendly' | 'neutral' | 'hostile'
  lastSeen?: string
}

interface Faction {
  id: string
  name: string
  influence: number // 0-10
  relationship?: 'allied' | 'neutral' | 'hostile'
  description?: string
}

interface Clock {
  id: string
  name: string
  current: number
  max: number
}

interface WorldStateDashboardProps {
  npcs?: NPC[]
  factions?: Faction[]
  clocks?: Clock[]
  worldNotes?: string[]
}

const NPC_STATUS_LABEL: Record<NPC['status'], { label: string; className: string }> = {
  alive: { label: 'Alive', className: 'text-myth-good' },
  dead: { label: 'Dead', className: 'text-myth-danger' },
  unknown: { label: 'Unknown', className: 'text-myth-ink-faint' },
}

const RELATIONSHIP_LABEL: Record<'friendly' | 'allied' | 'neutral' | 'hostile', { label: string; className: string }> = {
  friendly: { label: 'Friendly', className: 'bg-myth-good/10 text-myth-good' },
  allied: { label: 'Allied', className: 'bg-myth-good/10 text-myth-good' },
  neutral: { label: 'Neutral', className: 'bg-myth-ink/5 text-myth-ink-muted' },
  hostile: { label: 'Hostile', className: 'bg-myth-danger/10 text-myth-danger' },
}

function RelationshipBadge({ relationship }: { relationship?: 'friendly' | 'neutral' | 'hostile' | 'allied' }) {
  if (!relationship) return null
  const config = RELATIONSHIP_LABEL[relationship]
  return <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${config.className}`}>{config.label}</span>
}

function Panel({ icon: Icon, title, count, children }: { icon: React.ComponentType<{ className?: string }>; title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
      <h3 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-myth-ink">
        <Icon className="h-4 w-4 text-myth-ink-faint" />
        {title} ({count})
      </h3>
      <div className="max-h-96 space-y-2 overflow-y-auto">{children}</div>
    </div>
  )
}

export default function WorldStateDashboard({
  npcs = [],
  factions = [],
  clocks = [],
  worldNotes = []
}: WorldStateDashboardProps) {
  const criticalClocks = clocks.filter((c) => c.current >= c.max * 0.75).length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel icon={Users} title="NPCs" count={npcs.length}>
          {npcs.length === 0 ? (
            <p className="text-sm italic text-myth-ink-faint">No NPCs tracked yet</p>
          ) : (
            npcs.map((npc) => {
              const status = NPC_STATUS_LABEL[npc.status]
              return (
                <div key={npc.id} className="rounded-md border border-myth-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="truncate font-medium text-myth-ink">{npc.name}</h4>
                        <span className={`text-xs ${status.className}`}>{status.label}</span>
                      </div>
                      <p className="text-xs text-myth-ink-muted">{npc.role}</p>
                      {npc.lastSeen && <p className="mt-1 text-xs text-myth-ink-faint">Last seen: {npc.lastSeen}</p>}
                    </div>
                    <RelationshipBadge relationship={npc.relationship} />
                  </div>
                </div>
              )
            })
          )}
        </Panel>

        <Panel icon={Landmark} title="Factions" count={factions.length}>
          {factions.length === 0 ? (
            <p className="text-sm italic text-myth-ink-faint">No factions tracked yet</p>
          ) : (
            factions.map((faction) => (
              <div key={faction.id} className="rounded-md border border-myth-border p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h4 className="font-medium text-myth-ink">{faction.name}</h4>
                  <RelationshipBadge relationship={faction.relationship} />
                </div>
                {faction.description && <p className="mb-2 text-xs text-myth-ink-muted">{faction.description}</p>}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-myth-ink-faint">Influence</span>
                    <span className="font-mono text-myth-ink-muted">{faction.influence}/10</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-myth-border">
                    <div className="h-full bg-myth-ink-muted" style={{ width: `${(faction.influence / 10) * 100}%` }} />
                  </div>
                </div>
              </div>
            ))
          )}
        </Panel>

        <Panel icon={ClockIcon} title="Active Clocks" count={clocks.length}>
          {clocks.length === 0 ? (
            <p className="text-sm italic text-myth-ink-faint">No active clocks</p>
          ) : (
            clocks.map((clock) => <CompactClock key={clock.id} name={clock.name} current={clock.current} max={clock.max} />)
          )}
        </Panel>

        <Panel icon={StickyNote} title="World Notes" count={worldNotes.length}>
          {worldNotes.length === 0 ? (
            <p className="text-sm italic text-myth-ink-faint">No world notes yet</p>
          ) : (
            worldNotes.map((note, index) => (
              <div key={index} className="rounded-md border border-myth-border p-3">
                <p className="text-sm text-myth-ink-muted">{note}</p>
              </div>
            ))
          )}
        </Panel>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-myth-border p-5 text-center">
          <div className="font-display text-3xl font-semibold text-myth-good">{npcs.filter((n) => n.status === 'alive').length}</div>
          <div className="mt-1 text-xs text-myth-ink-faint">Active NPCs</div>
        </div>
        <div className="rounded-lg border border-myth-border p-5 text-center">
          <div className="font-display text-3xl font-semibold text-myth-ink">{factions.length}</div>
          <div className="mt-1 text-xs text-myth-ink-faint">Factions</div>
        </div>
        <div className={`rounded-lg border p-5 text-center ${criticalClocks > 0 ? 'border-myth-warn/40' : 'border-myth-border'}`}>
          <div className={`font-display text-3xl font-semibold ${criticalClocks > 0 ? 'text-myth-warn' : 'text-myth-ink'}`}>{criticalClocks}</div>
          <div className="mt-1 text-xs text-myth-ink-faint">Critical Clocks</div>
        </div>
        <div className="rounded-lg border border-myth-border p-5 text-center">
          <div className="font-display text-3xl font-semibold text-myth-ink">{worldNotes.length}</div>
          <div className="mt-1 text-xs text-myth-ink-faint">Notes</div>
        </div>
      </div>
    </div>
  )
}
