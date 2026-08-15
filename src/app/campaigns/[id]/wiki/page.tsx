// src/app/campaigns/[id]/wiki/page.tsx
//
// The Codex: written material a player reads — Lore, Items, Custom
// entries, and Rumors.
//
// The live entity browser (NPCs, Factions, Locations, Threads) moved to
// /world in the Phase 5 split; see components/wiki/EntityBrowser.tsx for
// why the two jobs were separated. Legacy `?type=` deep links for those
// four types are redirected there rather than rendering an empty tab,
// which keeps every bookmark, lobby tile and sidebar link from before the
// split working.

'use client'

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { Megaphone } from 'lucide-react'
import { EntityBrowser, type EntityBrowserTab } from '@/components/wiki/EntityBrowser'
import { ENTITY_ICONS } from '@/lib/ui/icons'

const CODEX_TABS: EntityBrowserTab[] = [
  { key: 'LORE', label: 'Lore', icon: ENTITY_ICONS.LORE },
  { key: 'ITEM', label: 'Items', icon: ENTITY_ICONS.ITEM },
  { key: 'QUEST', label: 'Quests', icon: ENTITY_ICONS.QUEST },
  { key: 'CUSTOM', label: 'Custom', icon: ENTITY_ICONS.CUSTOM },
  { key: 'RUMORS', label: 'Rumors', icon: Megaphone },
]

function CodexPage() {
  const params = useParams()
  const campaignId = params.id as string
  const world = `/campaigns/${campaignId}/world`

  return (
    <EntityBrowser
      tabs={CODEX_TABS}
      title="Codex"
      intro="Lore, items and rumors — the written record of this world."
      basePath={`/campaigns/${campaignId}/wiki`}
      redirectTypes={{ NPC: world, FACTION: world, LOCATION: world, CLOCK: world }}
    />
  )
}

export default function Page() {
  // EntityBrowser reads useSearchParams; without a boundary this route
  // opts out of static prerendering.
  return (
    <Suspense fallback={null}>
      <CodexPage />
    </Suspense>
  )
}
