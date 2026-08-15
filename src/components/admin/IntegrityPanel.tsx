'use client'

// Admin panel for the Integrity Engine (Phase 2) — reads what tickIntegrity
// already computed and persisted every world turn. Self-fetching, same
// pattern as LoreManagerPanel: the admin page shell doesn't own this data,
// it's only ever needed when this tab is actually open.

import { useEffect, useState } from 'react'
import { authenticatedFetch } from '@/lib/clientAuth'
import { SectionHeader } from '@/components/ui/section-header'

interface Violation {
  checkKey: string
  entityType: string
  entityId: string
  entityName: string
  description: string
}

interface Escalation {
  checkKey: string
  kind: 'recurring-entity' | 'systemic'
  entityIds: string[]
  turnNumbers: number[]
  occurrences: number
  sample: Violation
}

interface ValidationDegradation {
  window: number
  sampleSize: number
  degradedCount: number
  rate: number
  degraded: boolean
}

interface IntegrityReport {
  turnNumber: number
  timestamp: string
  violationsFound: number
  repairsApplied: number
  unrepaired: Violation[]
  escalations: Escalation[]
  perCheckMs: Record<string, number>
  // Not a structural violation — a rate signal over recent AI responses
  // (see game/integrity/checks/validationDegradation.ts). Absent when this
  // campaign hasn't yet had a full window of scene resolutions to judge.
  validationDegradation?: ValidationDegradation
}

interface IntegrityData {
  assessed: boolean
  lastCheckedAt: string | null
  latest: IntegrityReport | null
  history: IntegrityReport[]
}

interface WorldMetaPacing {
  currentTurnNumber: number
  currentInGameDate: string | null
  hoursSinceWorldTurn: number
  worldTurnHours: number | null
  lastRealTimeTickAt: string | null
}

const DEFAULT_WORLD_TURN_HOURS = 24

// Plain-English read of the same threshold check runWorldTurnIfDue makes
// (src/lib/game/worldTurn.ts) — this card doesn't run anything, it just
// shows the live accumulator so an admin can tell "not due yet" apart from
// "should have run and didn't" without digging through logs. Lives here
// rather than on Overview because "is the world actually advancing" is a
// world-health question, same family as the referential-integrity checks
// below it — even though under the hood they're unrelated subsystems
// (pacing/scheduling vs. data-consistency repair), they answer the same
// kind of question for an admin looking at this tab.
function describePacing(worldMeta: WorldMetaPacing): { label: string; detail: string } {
  const threshold = worldMeta.worldTurnHours ?? DEFAULT_WORLD_TURN_HOURS
  const remaining = threshold - worldMeta.hoursSinceWorldTurn
  if (remaining <= 0) {
    return {
      label: 'Turn is due',
      detail: `${worldMeta.hoursSinceWorldTurn.toFixed(1)}h banked ≥ ${threshold}h threshold — should tick on the next cron sweep. If this stays true across multiple days, the sweep is failing for this campaign specifically.`,
    }
  }
  return {
    label: 'Not due yet',
    detail: `${worldMeta.hoursSinceWorldTurn.toFixed(1)}h banked of ${threshold}h threshold — about ${remaining.toFixed(1)}h of banked time left before the next turn fires.`,
  }
}

function WorldTurnPacingCard({ worldMeta }: { worldMeta: WorldMetaPacing }) {
  const pacing = describePacing(worldMeta)
  return (
    <section>
      <SectionHeader
        as="h2"
        title="World Turn Pacing"
        description="The world tick advances once a full in-game day has passed in the story, not on a real-world clock — this shows how close the campaign is to its next one."
      />
      <div className="mt-3 space-y-3 rounded-lg border border-myth-border bg-myth-surface p-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-sm">
          <span className="text-myth-ink-muted">
            Turn <span className="text-myth-ink">{worldMeta.currentTurnNumber}</span>
            {worldMeta.currentInGameDate && <span className="text-myth-ink-faint"> · {worldMeta.currentInGameDate}</span>}
          </span>
          <span className="text-myth-ink-muted">
            Last heartbeat{' '}
            <span className="text-myth-ink">
              {worldMeta.lastRealTimeTickAt ? new Date(worldMeta.lastRealTimeTickAt).toLocaleString() : 'never swept'}
            </span>
          </span>
        </div>
        <div>
          <p className="text-sm font-medium text-myth-ink">{pacing.label}</p>
          <p className="mt-1 text-sm text-myth-ink-faint">{pacing.detail}</p>
        </div>
      </div>
    </section>
  )
}

export function IntegrityPanel({ campaignId, worldMeta }: { campaignId: string; worldMeta?: WorldMetaPacing | null }) {
  const [data, setData] = useState<IntegrityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await authenticatedFetch(`/api/campaigns/${campaignId}/integrity`)
        if (!res.ok) throw new Error('request failed')
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setError('Failed to load integrity data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [campaignId])

  if (loading) {
    return <p className="text-sm text-myth-ink-faint">Loading...</p>
  }

  if (error) {
    return <p className="text-sm text-myth-danger">{error}</p>
  }

  if (!data || !data.assessed || !data.latest) {
    return (
      <div className="space-y-6">
        {worldMeta && <WorldTurnPacingCard worldMeta={worldMeta} />}
        <section>
          <SectionHeader
            as="h2"
            title="World integrity"
            description="Catches broken references and other structural drift the simulation itself introduces — dangling ids, duplicate entities — and repairs them automatically. Nothing to see until the first world turn runs."
          />
          <p className="mt-3 text-xs text-myth-ink-faint">
            Checked automatically at the end of every world turn — this campaign hasn&apos;t had one yet.
          </p>
        </section>
      </div>
    )
  }

  const { latest, history } = data

  return (
    <div className="space-y-6">
      {worldMeta && <WorldTurnPacingCard worldMeta={worldMeta} />}
      <section>
        <SectionHeader
          as="h2"
          title="World integrity"
          description={`Turn ${latest.turnNumber} · ${new Date(latest.timestamp).toLocaleString()}`}
        />
        <div className="mt-3 grid grid-cols-3 gap-3 rounded-lg border border-myth-border bg-myth-surface p-5 text-center">
          <div className="rounded-md border border-myth-border p-3">
            <p className="text-lg font-mono text-myth-ink">{latest.violationsFound}</p>
            <p className="text-xs text-myth-ink-faint">violations found</p>
          </div>
          <div className="rounded-md border border-myth-border p-3">
            <p className="text-lg font-mono text-myth-ink">{latest.repairsApplied}</p>
            <p className="text-xs text-myth-ink-faint">repaired</p>
          </div>
          <div className="rounded-md border border-myth-border p-3">
            <p className="text-lg font-mono text-myth-ink">{latest.unrepaired.length}</p>
            <p className="text-xs text-myth-ink-faint">unrepaired</p>
          </div>
        </div>
      </section>

      {latest.escalations.length > 0 && (
        <section className="rounded-lg border border-myth-danger/40/40 p-5">
          <h3 className="font-medium text-myth-ink">Escalations — looks like a code bug, not routine drift</h3>
          <div className="mt-3 space-y-2">
            {latest.escalations.map((esc, i) => (
              <div key={i} className="rounded-md border border-myth-danger/40/30 p-3">
                <p className="text-sm text-myth-ink">
                  <span className="font-mono text-xs text-myth-ink-muted">{esc.checkKey}</span>
                  {' — '}
                  {esc.kind === 'recurring-entity'
                    ? `keeps recurring on ${esc.sample.entityName} across turns ${esc.turnNumbers.join(', ')}`
                    : `fired on ${esc.entityIds.length} different entities`}
                </p>
                <p className="mt-1 text-xs italic text-myth-ink-faint">{esc.sample.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {latest.validationDegradation && (
        <section
          className={`rounded-lg border p-5 ${
            latest.validationDegradation.degraded
              ? 'border-myth-danger/40/40'
              : 'border-myth-border bg-myth-surface'
          }`}
        >
          <h3 className="font-medium text-myth-ink">
            {latest.validationDegradation.degraded
              ? 'AI response validation is degrading'
              : 'AI response validation'}
          </h3>
          <p className="mt-1 text-xs text-myth-ink-faint">
            {latest.validationDegradation.degradedCount}/{latest.validationDegradation.sampleSize} of the
            last scene resolutions fell back to partial/emergency validation instead of a full response
            ({Math.round(latest.validationDegradation.rate * 100)}%).
            {latest.validationDegradation.degraded &&
              ' Worth checking whether a required field is silently being dropped somewhere in the validation ladder.'}
          </p>
        </section>
      )}

      {latest.unrepaired.length > 0 && (
        <section className="rounded-lg border border-myth-border bg-myth-surface p-5">
          <h3 className="font-medium text-myth-ink">Unrepaired</h3>
          <p className="mb-3 mt-1 text-xs text-myth-ink-faint">
            Flagged but not auto-fixable — either no repair exists yet, or this pass hit its blast-radius cap.
          </p>
          <div className="space-y-2">
            {latest.unrepaired.map((v, i) => (
              <div key={i} className="rounded-md border border-myth-border p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium text-myth-ink">{v.entityName}</span>
                  <span className="font-mono text-xs text-myth-ink-faint">{v.checkKey}</span>
                </div>
                <p className="text-xs text-myth-ink-muted">{v.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-myth-border bg-myth-surface p-5">
        <h3 className="font-medium text-myth-ink">Per-check timing (last pass)</h3>
        <div className="mt-3 space-y-1">
          {Object.entries(latest.perCheckMs).map(([key, ms]) => (
            <div key={key} className="flex items-center justify-between text-xs">
              <span className="font-mono text-myth-ink-muted">{key}</span>
              <span className="text-myth-ink-faint">{ms}ms</span>
            </div>
          ))}
        </div>
      </section>

      {history.length > 1 && (
        <section className="rounded-lg border border-myth-border bg-myth-surface p-5">
          <h3 className="font-medium text-myth-ink">Recent history</h3>
          <div className="mt-3 space-y-1">
            {history
              .slice()
              .reverse()
              .map((r, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-myth-ink-muted">Turn {r.turnNumber}</span>
                  <span className="text-myth-ink-faint">
                    {r.violationsFound} found · {r.repairsApplied} repaired
                    {r.escalations.length > 0 ? ` · ${r.escalations.length} escalation(s)` : ''}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  )
}
