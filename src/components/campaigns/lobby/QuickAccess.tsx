// src/components/campaigns/lobby/QuickAccess.tsx
//
// The mockup's image-backed nav cards. 2×2 on a phone, a single row of
// four from lg: — the same "adapt upward" relationship the chrome uses.
//
// The art is four static SVGs bundled in public/images/quick-access/,
// which was a deliberate choice over per-campaign generated art: these
// are navigation affordances, not content. Generated art would mean an
// AI call, blob storage, a failure state, and a per-campaign cost, for
// four cards that say the same thing in every campaign. Static assets
// are a few hundred bytes each, can't fail, and can't be absent.
//
// They're decorative and marked aria-hidden — the card's label is the
// accessible name, and describing an abstract gradient to a screen
// reader would be noise.

import Link from 'next/link'
import { Users, Landmark, Swords, BookOpen } from 'lucide-react'

interface QuickAccessCard {
  label: string
  href: string
  art: string
  icon: React.ComponentType<{ className?: string }>
}

export function QuickAccess({ campaignId }: { campaignId: string }) {
  const cards: QuickAccessCard[] = [
    {
      label: 'Characters',
      href: `/campaigns/${campaignId}/characters`,
      art: '/images/quick-access/characters.svg',
      icon: Users,
    },
    {
      label: 'Locations',
      href: `/campaigns/${campaignId}/wiki?type=LOCATION`,
      art: '/images/quick-access/locations.svg',
      icon: Landmark,
    },
    {
      label: 'Factions',
      href: `/campaigns/${campaignId}/wiki?type=FACTION`,
      art: '/images/quick-access/factions.svg',
      icon: Swords,
    },
    {
      label: 'Campaign Wiki',
      href: `/campaigns/${campaignId}/wiki`,
      art: '/images/quick-access/codex.svg',
      icon: BookOpen,
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => (
        <Link
          key={card.href}
          href={card.href}
          className="group relative flex min-h-[88px] items-end overflow-hidden rounded-xl border border-myth-border transition-colors hover:border-myth-border-strong"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a bundled static SVG; next/image adds a loader round trip for an asset already in the bundle. */}
          <img
            src={card.art}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover opacity-40 transition-opacity group-hover:opacity-55"
          />
          {/* Reading scrim: the label sits over art in both themes, so it
              needs its own ground rather than relying on the art being
              dark enough. */}
          <div className="absolute inset-0 bg-gradient-to-t from-myth-canvas via-myth-canvas/80 to-transparent" />
          <div className="relative flex items-center gap-2 p-3">
            <card.icon className="h-4 w-4 flex-shrink-0 text-myth-accent" />
            <span className="font-mono text-xs uppercase tracking-wide text-myth-ink">{card.label}</span>
          </div>
        </Link>
      ))}
    </div>
  )
}
