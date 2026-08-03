import { CloudSun, Shield, Swords, Sparkles } from 'lucide-react'
import { SectionHeader } from '@/components/ui/section-header'
import type { ChronicleGlance } from '@/lib/game/chronicleTypes'

// A row of icon-led glance tiles sitting above WorldChronicle's prose —
// reference/glanceable content (A2's convention), so it stays bordered,
// just with more visual weight (icon chip, raised surface, rounded-xl)
// than the flat StatTile-style box this replaces. Sourced from
// chronicleGlance, derived once per world turn alongside the chronicle
// narration (see chronicleContext.ts's deriveChronicleGlance) — never a
// fresh query on page load.
function GlanceTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex min-w-[11rem] flex-1 items-start gap-3 rounded-xl border border-myth-border bg-myth-surface-raised p-4">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-myth-accent/10 text-myth-accent">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="font-mono text-xs uppercase tracking-wider text-myth-ink-faint">{label}</p>
        <p className="mt-0.5 text-sm text-myth-ink">{value}</p>
      </div>
    </div>
  )
}

export function WorldGlance({
  glance,
  turnNumber,
}: {
  glance: ChronicleGlance | null
  turnNumber: number
}) {
  if (!glance) return null

  return (
    <div className="space-y-3">
      <SectionHeader as="h2" title="World at a Glance" description={`As of Turn ${turnNumber}`} />
      <div className="flex flex-wrap gap-3">
        <GlanceTile icon={CloudSun} label="Weather" value={glance.weatherLabel ?? 'Unknown'} />
        <GlanceTile
          icon={Shield}
          label="Faction Activity"
          value={glance.topFaction ? `${glance.topFaction.name} (threat ${glance.topFaction.threatLevel})` : 'Quiet'}
        />
        <GlanceTile
          icon={Swords}
          label="Conflicts"
          value={glance.activeConflictCount > 0 ? `${glance.activeConflictCount} active` : 'None active'}
        />
        <GlanceTile
          icon={Sparkles}
          label="Recent Events"
          value={glance.recentEventCount > 0 ? `${glance.recentEventCount} new` : 'Nothing new'}
        />
      </div>
    </div>
  )
}
