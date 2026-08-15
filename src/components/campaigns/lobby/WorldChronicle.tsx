import { SectionHeader } from '@/components/ui/section-header'
import { resolveWorldTurnHours } from '@/lib/game/tick/pacing'

// Replaces the old WorldSummaryPanel stat-tile grid. The design principle:
// "A dashboard shows you data. A chronicle tells you a story about the
// same data." narration is generated prose (see lib/ai/chronicleNarration.ts,
// regenerated once per world turn, never live per view) — single column,
// no borders, no card chrome, no counts. The index below is the one
// concession to genuine reference material, and deliberately carries no
// counts either. Tier-2 SectionHeader (not Tier 3) since this is the
// flagship de-boxed section, not a card-scoped title.
//
// The progress bar is in-game hours, not a real-world countdown: the
// gate is WorldMeta.hoursSinceWorldTurn crossing worldTurnHours (accrued
// via scene time_passage), not a wall-clock timer, so a real countdown
// would overstate precision that doesn't exist.
export function WorldChronicle({
  campaignId,
  narration,
  hoursSinceWorldTurn,
  worldTurnHours,
}: {
  campaignId: string
  narration: string | null
  hoursSinceWorldTurn?: number | null
  worldTurnHours?: number | null
}) {
  const threshold = resolveWorldTurnHours({ worldTurnHours: worldTurnHours ?? null })
  const elapsed = Math.max(0, hoursSinceWorldTurn ?? 0)
  const progressPct = Math.min(100, (elapsed / threshold) * 100)

  return (
    <div className="space-y-3">
      <SectionHeader as="h2" title="Word From the World" />
      {narration ? (
        <p className="leading-relaxed text-myth-ink-muted">{narration}</p>
      ) : (
        <p className="italic text-myth-ink-faint">The chronicle has yet to be written for this turn.</p>
      )}
      {hoursSinceWorldTurn != null && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-myth-surface-sunken">
            <div
              className="h-full rounded-full bg-myth-accent transition-[width]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-xs text-myth-ink-faint">
            {Math.round(elapsed)} of {threshold} in-game hours since the last update
          </p>
        </div>
      )}
      {/* The inline "Characters · Locations · Factions · Threads · Full
          wiki" index that used to sit here is gone. QuickAccess renders
          directly below this with the same destinations as real 88px
          cards, and Phase 1 put Threads in both the drawer and the
          sidebar — so this was the same navigation a third time, at a
          20px tap target, which is the worst of the three. */}
    </div>
  )
}
