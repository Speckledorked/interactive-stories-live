// src/app/campaigns/[id]/world/page.tsx
//
// The World browser: the live entities the simulation writes every tick —
// NPCs, Factions, Locations and Threads.
//
// This is the other half of the Phase 5 split; the written record (Lore,
// Items, Quests, Custom, Rumors) stays at /wiki as the Codex. See
// components/wiki/EntityBrowser.tsx for why the two jobs were separated.
// Legacy `?type=` deep links belonging to the Codex are redirected there
// rather than rendering an empty tab, so bookmarks and older links from
// before the split keep resolving.

'use client'

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { EntityBrowser, type EntityBrowserTab } from '@/components/wiki/EntityBrowser'
import { ENTITY_ICONS } from '@/lib/ui/icons'

const WORLD_TABS: EntityBrowserTab[] = [
  { key: 'NPC', label: 'NPCs', icon: ENTITY_ICONS.NPC },
  { key: 'FACTION', label: 'Factions', icon: ENTITY_ICONS.FACTION },
  { key: 'LOCATION', label: 'Locations', icon: ENTITY_ICONS.LOCATION },
  { key: 'CLOCK', label: 'Threads', icon: ENTITY_ICONS.CLOCK },
]

function WorldPage() {
  const params = useParams()
  const campaignId = params.id as string
  const codex = `/campaigns/${campaignId}/wiki`

  return (
    <EntityBrowser
      tabs={WORLD_TABS}
      title="World"
      intro="The people, powers and places this world is currently moving."
      basePath={`/campaigns/${campaignId}/world`}
      redirectTypes={{ LORE: codex, ITEM: codex, QUEST: codex, CUSTOM: codex, RUMORS: codex }}
    />
  )
}

export default function Page() {
  // EntityBrowser reads useSearchParams; without a boundary this route
  // opts out of static prerendering.
  return (
    <Suspense fallback={null}>
      <WorldPage />
    </Suspense>
  )
}
