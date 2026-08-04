import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

// Content only — no wrapping card. Rendered inside CampaignHero directly
// under the title/description, matching the mockup's single cohesive
// title -> subtitle -> button hero block rather than a separate CTA card
// below it.
export function CampaignEntryCTA({
  campaignId,
  hasCharacter,
  onCreateCharacter,
}: {
  campaignId: string
  hasCharacter: boolean
  onCreateCharacter: () => void
}) {
  const className =
    'mt-5 inline-flex items-center gap-2 rounded-full bg-myth-accent px-6 py-3 text-sm font-medium text-myth-accent-ink transition-colors hover:bg-myth-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-myth-accent focus-visible:ring-offset-2'

  return hasCharacter ? (
    <Link href={`/campaigns/${campaignId}/story`} className={className}>
      Enter Story
      <ArrowRight className="h-4 w-4" />
    </Link>
  ) : (
    <button type="button" onClick={onCreateCharacter} className={className}>
      Create Character to Begin
      <ArrowRight className="h-4 w-4" />
    </button>
  )
}
