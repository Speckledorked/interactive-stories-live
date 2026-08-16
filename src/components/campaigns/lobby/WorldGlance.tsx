import Link from 'next/link'
import { CloudSun, Shield, Swords, Sparkles, MessageCircle } from 'lucide-react'
import { SectionHeader } from '@/components/ui/section-header'
import type { ChronicleGlance } from '@/lib/game/chronicleTypes'
import { describeThreat } from '@/lib/game/entityStats'

// A row of icon-led glance tiles sitting above WorldChronicle's prose —
// reference/glanceable content (A2's convention), so it stays bordered,
// just with more visual weight (icon chip, raised surface, rounded-xl)
// than the flat StatTile-style box this replaces. Sourced from
// chronicleGlance, derived once per world turn alongside the chronicle
// narration (see chronicleContext.ts's deriveChronicleGlance) — never a
// fresh query on page load.
//
// Every tile links somewhere real rather than sitting inert: Weather and
// Faction Activity deep-link to the specific /world entry when one is
// known (falling back to the general tab otherwise — chronicleGlance JSON
// persisted before weatherLocationName existed won't have it yet, same
// null-vs-absent caveat the field's own doc comment names), Conflicts
// goes to Factions (wars are fought between factions, and there's no
// dedicated entry type for a war itself), Rumors and World Events
// both go to the Story Log tab, which is the actual chronological
// history behind both.
//
// Layout is a 2-column grid on mobile rather than a horizontal scroller:
// these are glanceable status, not a browsable list, and a scroller
// hides tiles 3-5 behind an interaction most people never perform. It
// widens to 3 at sm: and the mockup's single row of 5 at lg:.
function GlanceTile({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  href: string
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[44px] items-start gap-3 rounded-xl border border-myth-border bg-myth-surface-raised p-3 transition-colors hover:border-myth-border-strong hover:bg-myth-surface-sunken sm:p-4"
    >
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-myth-accent/10 text-myth-accent sm:h-9 sm:w-9">
        <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
      </div>
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-wider text-myth-ink-faint sm:text-xs">{label}</p>
        {/* break-words: a long faction name is the realistic overflow
            case in a half-width tile at 390px. */}
        <p className="mt-0.5 break-words text-sm text-myth-ink">{value}</p>
      </div>
    </Link>
  )
}

export function WorldGlance({
  campaignId,
  glance,
  turnNumber,
}: {
  campaignId: string
  glance: ChronicleGlance | null
  turnNumber: number
}) {
  if (!glance) return null

  // Both counts are optional on the persisted JSON: a campaign whose
  // chronicleGlance predates them keeps rendering, showing the whole feed
  // under World Events until its next world turn refreshes the split.
  const rumorCount = glance.rumorCount ?? 0
  const worldEventCount = glance.worldEventCount ?? glance.recentEventCount

  // Weather, factions and conflicts are all live entities, so these deep
  // links go to /world rather than the Codex.
  const worldHref = (type: string, entryName?: string | null) =>
    entryName
      ? `/campaigns/${campaignId}/world?type=${type}&entry=${encodeURIComponent(entryName)}`
      : `/campaigns/${campaignId}/world?type=${type}`

  return (
    <div className="space-y-3">
      <SectionHeader as="h2" title="World at a Glance" description={`As of Turn ${turnNumber}`} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <GlanceTile
          icon={CloudSun}
          label="Weather"
          value={glance.weatherLabel ?? 'Unknown'}
          href={worldHref('LOCATION', glance.weatherLocationName)}
        />
        <GlanceTile
          icon={Shield}
          label="Faction Activity"
          // Diegetic band, not the raw 1-5 integer — "House Vale (threat 4)"
          // reads as a stat block on a screen whose whole job is in-world
          // prose. describeThreat is the same helper EntityStatRow already
          // uses for this exact field.
          value={glance.topFaction ? `${glance.topFaction.name} — ${describeThreat(glance.topFaction.threatLevel)}` : 'Quiet'}
          href={worldHref('FACTION', glance.topFaction?.name)}
        />
        <GlanceTile
          icon={Swords}
          label="Conflicts"
          value={glance.activeConflictCount > 0 ? `${glance.activeConflictCount} active` : 'None active'}
          href={worldHref('FACTION')}
        />
        <GlanceTile
          icon={MessageCircle}
          label="Rumors"
          value={rumorCount > 0 ? `${rumorCount} circulating` : 'None heard'}
          href={`/campaigns/${campaignId}?tab=progression`}
        />
        <GlanceTile
          icon={Sparkles}
          label="World Events"
          value={worldEventCount > 0 ? `${worldEventCount} new` : 'Nothing new'}
          href={`/campaigns/${campaignId}?tab=progression`}
        />
      </div>
    </div>
  )
}
