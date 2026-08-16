// src/components/wiki/EntityStatRow.tsx
//
// The live-state strip under an entity's name on a /world list card.
//
// Without this the World browser's cards were the Codex's cards: a name
// and a prose summary, identical whether the faction was ascendant or
// collapsing. These are the numbers the tick actually moved.
//
// Mobile is the constraint that shapes it. At 390px a card is the full
// column width minus padding, so:
//   - meters sit in a 2-col grid that collapses to 1 below `xs`, and each
//     label/value pair is `min-w-0` with a truncating name, so a long
//     stat label can't push the meter to zero width;
//   - tags wrap rather than scroll, and past MAX_VISIBLE_TAGS collapse to
//     a "+N" counter — the same overflow treatment the NPC standing
//     badges needed once already;
//   - nothing here is interactive, so none of it competes for tap
//     targets with the card itself, which is the actual link.

import { Progress } from '@/components/ui/progress'
import {
  describeConditionTag,
  describeStability,
  describeThreat,
  describeWeather,
  stabilityTone,
  threatTone,
  THREAT_MAX,
  type EntityStats,
} from '@/lib/game/entityStats'

/** Past this, tags collapse to a count rather than wrapping to a third row. */
const MAX_VISIBLE_TAGS = 3

function Meter({
  label,
  value,
  max,
  display,
  tone,
}: {
  label: string
  value: number
  max: number
  display: string
  tone: 'accent' | 'good' | 'warn' | 'danger' | 'neutral'
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-[10px] uppercase tracking-wider text-myth-ink-faint">{label}</span>
        <span className="flex-shrink-0 text-[11px] text-myth-ink-muted">{display}</span>
      </div>
      <Progress className="mt-1" size="sm" value={value} max={max} tone={tone} label={label} />
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-myth-border bg-myth-surface-sunken px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-myth-ink-muted">
      {children}
    </span>
  )
}

/** Takes display-ready labels — callers format their own vocabulary. */
function TagRow({ tags }: { tags: string[] }) {
  const visible = tags.slice(0, MAX_VISIBLE_TAGS)
  const overflow = tags.length - visible.length
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((t) => (
        <Tag key={t}>{t}</Tag>
      ))}
      {overflow > 0 && <Tag>+{overflow}</Tag>}
    </div>
  )
}

export function EntityStatRow({ stats }: { stats: EntityStats }) {
  if (stats.kind === 'FACTION') {
    return (
      <div className="mt-3 space-y-2">
        {/* A collapsed faction still has numbers, but they describe a
            corpse — say so plainly rather than showing a healthy-looking
            meter row with no context. */}
        {!stats.isActive && <TagRow tags={['Collapsed']} />}
        <div className="grid grid-cols-1 gap-x-4 gap-y-2 min-[380px]:grid-cols-2">
          <Meter
            label="Threat"
            value={stats.threatLevel}
            max={THREAT_MAX}
            display={describeThreat(stats.threatLevel)}
            tone={threatTone(stats.threatLevel)}
          />
          <Meter
            label="Stability"
            value={stats.stability}
            max={100}
            display={describeStability(stats.stability)}
            tone={stabilityTone(stats.stability)}
          />
        </div>
      </div>
    )
  }

  if (stats.kind === 'LOCATION') {
    return (
      <div className="mt-3 space-y-2">
        <TagRow
          tags={[
            ...stats.conditionTags.map(describeConditionTag),
            describeWeather(stats.weather, stats.weatherSeverity),
          ]}
        />
        {/* Banded like every sibling meter in this file. This was the one
            that printed a raw "72/100" — while already calling
            stabilityTone() on the same value for its colour, so the 0-100
            band function was one argument away. */}
        <Meter
          label="Condition"
          value={stats.conditionScore}
          max={100}
          display={describeStability(stats.conditionScore)}
          tone={stabilityTone(stats.conditionScore)}
        />
      </div>
    )
  }

  // CLOCK — neutral tone on purpose: a clock filling is not inherently
  // good or bad, it depends entirely on whose clock it is.
  const { currentTicks, maxTicks, category } = stats
  return (
    <div className="mt-3 space-y-2">
      {category && <TagRow tags={[describeConditionTag(category)]} />}
      <Meter
        label="Progress"
        value={currentTicks}
        max={maxTicks}
        display={`${currentTicks}/${maxTicks}`}
        tone="accent"
      />
    </div>
  )
}
