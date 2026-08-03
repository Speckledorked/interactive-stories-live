// Left-aligned page hero for the campaign lobby: display-serif title, a
// single italic log-line instead of a paragraph, and Universe/Turn/Date
// collapsed into one row of tabular-mono chips.

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded border border-myth-border bg-myth-surface-sunken px-2 py-1 font-mono text-xs">
      <span className="text-myth-ink-faint">{label}</span>
      <span className="text-myth-ink">{value}</span>
    </div>
  )
}

export function CampaignHero({
  title,
  description,
  universe,
  turnNumber,
  inGameDate,
  heroImageUrl,
}: {
  title: string
  description?: string
  universe?: string
  turnNumber: number
  inGameDate: string
  heroImageUrl?: string | null
}) {
  return (
    <div className="relative mb-8 overflow-hidden rounded-lg">
      {heroImageUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- no next/image remote-host config exists yet; plain <img> matches the only existing convention in the app (wiki/page.tsx). */}
          <img src={heroImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-myth-canvas via-myth-canvas/70 to-transparent" />
        </>
      )}
      <div className={heroImageUrl ? 'relative px-5 py-10 sm:py-14' : ''}>
        <h1 className="font-display text-3xl font-semibold text-myth-ink sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 italic text-myth-ink-muted">{description}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {universe && <MetaChip label="Universe" value={universe} />}
          <MetaChip label="Turn" value={String(turnNumber)} />
          <MetaChip label="Date" value={inGameDate} />
        </div>
      </div>
    </div>
  )
}
