import Link from 'next/link'

interface WikiTile {
  label: string
  href: string
  count: number | null
}

function Tile({ tile }: { tile: WikiTile }) {
  const isEmpty = tile.count === 0
  return (
    <Link
      href={tile.href}
      className={`flex flex-col gap-1 rounded-md border border-myth-border p-3 transition-colors hover:border-myth-border-strong hover:bg-myth-surface-sunken ${
        isEmpty ? 'opacity-60' : ''
      }`}
    >
      <span className="text-xs text-myth-ink-muted">{tile.label}</span>
      {tile.count === null ? (
        <span className="font-mono text-lg text-myth-ink">—</span>
      ) : isEmpty ? (
        <span className="text-xs text-myth-ink-faint">nothing recorded yet</span>
      ) : (
        <span className="font-mono text-lg text-myth-ink">{tile.count}</span>
      )}
    </Link>
  )
}

export function WorldSummaryPanel({
  campaignId,
  factionCount,
  clockCount,
  inGameDate,
  characterCount,
  npcCount,
  locationCount,
}: {
  campaignId: string
  factionCount: number
  clockCount: number
  inGameDate: string
  characterCount: number
  npcCount: number
  locationCount: number
}) {
  const tiles: WikiTile[] = [
    { label: 'Characters', href: `/campaigns/${campaignId}/characters`, count: characterCount },
    { label: 'NPCs', href: `/campaigns/${campaignId}/wiki?type=NPC`, count: npcCount },
    { label: 'Factions', href: `/campaigns/${campaignId}/wiki?type=FACTION`, count: factionCount },
    { label: 'Locations', href: `/campaigns/${campaignId}/wiki?type=LOCATION`, count: locationCount },
    { label: 'Clocks', href: `/campaigns/${campaignId}/wiki?type=CLOCK`, count: clockCount },
    { label: 'Items', href: `/campaigns/${campaignId}/wiki?type=ITEM`, count: null },
    { label: 'Quests', href: `/campaigns/${campaignId}/wiki?type=QUEST`, count: null },
    { label: 'Rumors', href: `/campaigns/${campaignId}/wiki?type=RUMORS`, count: null },
  ]

  return (
    <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
      <h2 className="font-display text-lg font-semibold text-myth-ink">World</h2>
      <p className="mt-1 text-sm text-myth-ink-muted">
        {factionCount} {factionCount === 1 ? 'faction' : 'factions'} in motion · {clockCount} active {clockCount === 1 ? 'clock' : 'clocks'} ·{' '}
        {inGameDate}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((tile) => (
          <Tile key={tile.label} tile={tile} />
        ))}
      </div>
      <Link
        href={`/campaigns/${campaignId}/wiki`}
        className="mt-4 inline-block text-sm text-myth-ink-muted underline-offset-2 hover:text-myth-ink hover:underline"
      >
        Open full wiki →
      </Link>
    </div>
  )
}
