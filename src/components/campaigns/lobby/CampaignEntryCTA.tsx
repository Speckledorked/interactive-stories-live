import Link from 'next/link'

// One component, two content states. Only this filled-accent button is
// visible above the fold — everything else on the page is neutral.
export function CampaignEntryCTA({
  campaignId,
  hasCharacter,
  onCreateCharacter,
}: {
  campaignId: string
  hasCharacter: boolean
  onCreateCharacter: () => void
}) {
  return (
    <div className="mb-6 rounded-lg border border-myth-border bg-myth-surface p-5">
      {hasCharacter ? (
        <>
          <h2 className="font-display text-lg font-semibold text-myth-ink">Ready to play</h2>
          <p className="mt-1 text-sm text-myth-ink-muted">Jump back into the story where you left off.</p>
          <Link
            href={`/campaigns/${campaignId}/story`}
            className="mt-4 inline-flex items-center justify-center rounded-md bg-myth-accent px-4 py-2.5 text-sm font-medium text-myth-accent-ink transition-colors hover:bg-myth-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-myth-accent focus-visible:ring-offset-2"
          >
            Enter Story
          </Link>
        </>
      ) : (
        <>
          <h2 className="font-display text-lg font-semibold text-myth-ink">Create a character to begin</h2>
          <p className="mt-1 text-sm text-myth-ink-muted">You'll need a character in this campaign before you can enter the story.</p>
          <button
            type="button"
            onClick={onCreateCharacter}
            className="mt-4 inline-flex items-center justify-center rounded-md bg-myth-accent px-4 py-2.5 text-sm font-medium text-myth-accent-ink transition-colors hover:bg-myth-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-myth-accent focus-visible:ring-offset-2"
          >
            Create Character
          </button>
        </>
      )}
    </div>
  )
}
