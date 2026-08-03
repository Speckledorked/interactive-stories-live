import Link from 'next/link'
import { SectionHeader } from '@/components/ui/section-header'

// Replaces the old WorldSummaryPanel stat-tile grid. The design principle:
// "A dashboard shows you data. A chronicle tells you a story about the
// same data." narration is generated prose (see lib/ai/chronicleNarration.ts,
// regenerated once per world turn, never live per view) — single column,
// no borders, no card chrome, no counts. The index below is the one
// concession to genuine reference material, and deliberately carries no
// counts either. Tier-2 SectionHeader (not Tier 3) since this is the
// flagship de-boxed section, not a card-scoped title.
export function WorldChronicle({
  campaignId,
  narration,
}: {
  campaignId: string
  narration: string | null
}) {
  return (
    <div className="space-y-3">
      <SectionHeader as="h2" title="The World, Now" />
      {narration ? (
        <p className="leading-relaxed text-myth-ink-muted">{narration}</p>
      ) : (
        <p className="italic text-myth-ink-faint">The chronicle has yet to be written for this turn.</p>
      )}
      <div className="pt-1 text-sm text-myth-ink-faint">
        <Link href={`/campaigns/${campaignId}/characters`} className="hover:text-myth-ink hover:underline">
          Characters
        </Link>
        {' · '}
        <Link href={`/campaigns/${campaignId}/wiki?type=LOCATION`} className="hover:text-myth-ink hover:underline">
          Locations
        </Link>
        {' · '}
        <Link href={`/campaigns/${campaignId}/wiki?type=FACTION`} className="hover:text-myth-ink hover:underline">
          Factions
        </Link>
        {' · '}
        <Link href={`/campaigns/${campaignId}/wiki?type=CLOCK`} className="hover:text-myth-ink hover:underline">
          Clocks
        </Link>
        {' · '}
        <Link href={`/campaigns/${campaignId}/wiki`} className="hover:text-myth-ink hover:underline">
          Full wiki
        </Link>
      </div>
    </div>
  )
}
