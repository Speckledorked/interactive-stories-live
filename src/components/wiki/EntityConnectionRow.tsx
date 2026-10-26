// src/components/wiki/EntityConnectionRow.tsx
//
// The live CONNECTIONS strip on a /world list card (#521).
//
// EntityStatRow shows what the tick did to an entity's numbers. This shows
// what the tick did to its relationships — the four tables that ran every
// turn with no reader anywhere: who an NPC knows, who a faction owes, what
// can still reach a place, and who is leaving it.
//
// Same mobile constraint as its sibling: tags wrap rather than scroll,
// nothing is interactive so none of it competes with the card's own tap
// target, and every long name truncates rather than pushing the row wide.
//
// Renders null for an entity with nothing on record. Most entities in a
// young campaign have no ties, no debts and no routes, and an empty
// "Connections" heading on every card would be noise on the surface whose
// whole point is showing what moved.

import { TagRow } from './EntityStatRow'
import type { EntityConnections } from '@/lib/game/entityConnections'

/** Past this, names collapse to a count — same treatment as stat tags. */
const MAX_VISIBLE_NAMES = 3

function NameLine({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null
  const visible = names.slice(0, MAX_VISIBLE_NAMES)
  const overflow = names.length - visible.length
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="flex-shrink-0 font-mono text-[10px] uppercase tracking-wider text-myth-ink-faint">
        {label}
      </span>
      <span className="truncate text-[11px] text-myth-ink-muted">
        {visible.join(', ')}
        {overflow > 0 && ` +${overflow}`}
      </span>
    </div>
  )
}

export function EntityConnectionRow({ connections }: { connections: EntityConnections }) {
  if (connections.kind === 'NPC') {
    const { allies, rivals } = connections
    if (allies.length === 0 && rivals.length === 0) return null
    return (
      <div className="mt-3 space-y-1">
        <NameLine label="Allies" names={allies} />
        <NameLine label="Rivals" names={rivals} />
      </div>
    )
  }

  if (connections.kind === 'FACTION') {
    const { owes, owed } = connections
    if (owes.length === 0 && owed.length === 0) return null
    return (
      <div className="mt-3 space-y-1">
        {/* The weight is the band, never the integer — the payload only
            carries an amount for an admin, and nothing renders it. */}
        <NameLine label="Owes" names={owes.map((d) => `${d.faction} (${d.weight.toLowerCase()})`)} />
        <NameLine label="Owed by" names={owed.map((d) => `${d.faction} (${d.weight.toLowerCase()})`)} />
      </div>
    )
  }

  const { routes, cutOff, fleeingTo } = connections
  if (routes.length === 0 && fleeingTo.length === 0) return null
  const open = routes.filter((r) => !r.blockaded).map((r) => r.to)
  const blockaded = routes.filter((r) => r.blockaded).map((r) => r.to)
  return (
    <div className="mt-3 space-y-1">
      {/* Said first and said plainly. A place whose every known route is
          blockaded is starving, and that is the one piece of logistics
          state with immediate consequences for anyone standing in it. */}
      {cutOff && <TagRow tags={['Cut off']} />}
      <NameLine label="Supplied from" names={open} />
      <NameLine label="Blockaded" names={blockaded} />
      {fleeingTo.length > 0 && (
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="flex-shrink-0 font-mono text-[10px] uppercase tracking-wider text-myth-ink-faint">
            Leaving for
          </span>
          <span className="truncate text-[11px] text-myth-ink-muted">{fleeingTo.join(', ')}</span>
        </div>
      )}
    </div>
  )
}
