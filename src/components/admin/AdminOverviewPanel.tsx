import { SectionHeader } from '@/components/ui/section-header'
import { SetupChecklist, type SetupChecklistItem } from '@/components/admin/SetupChecklist'
import WorldStateDashboard from '@/components/admin/WorldStateDashboard'

interface CampaignIdentity {
  title: string
  description: string | null
  universe: string | null
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
// (src/lib/game/worldTurn.ts) — this panel doesn't run anything, it just
// shows the live accumulator so an admin can tell "not due yet" apart from
// "should have run and didn't" without digging through logs.
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

export function AdminOverviewPanel({
  campaignId,
  campaign,
  worldMeta,
  onCampaignChange,
  onSaveCampaignInfo,
  saving,
  checklistItems,
  npcs,
  factions,
  clocks,
  worldNotes,
}: {
  campaignId: string
  campaign: CampaignIdentity
  worldMeta?: WorldMetaPacing | null
  onCampaignChange: (campaign: CampaignIdentity) => void
  onSaveCampaignInfo: () => void
  saving: boolean
  checklistItems: SetupChecklistItem[]
  npcs: Array<{ id: string; name: string; role: string; status: 'alive' | 'dead'; relationship?: string; lastSeen: string }>
  factions: Array<{ id: string; name: string; influence: number; relationship: 'hostile' | 'neutral' | 'allied'; description: string }>
  clocks: Array<{ id: string; name: string; current: number; max: number }>
  worldNotes: string[]
}) {
  const pacing = worldMeta ? describePacing(worldMeta) : null
  return (
    <div className="space-y-8">
      <section>
        <SectionHeader eyebrow="Getting started" title="Setup" as="h2" />
        <div className="mt-3">
          <SetupChecklist items={checklistItems} />
        </div>
      </section>

      <section>
        <SectionHeader title="Campaign Identity" as="h2" />
        <div className="mt-3 space-y-4 rounded-lg border border-myth-border bg-myth-surface p-5">
          <div>
            <label className="block text-sm font-medium text-myth-ink-muted">Campaign ID</label>
            <p className="mt-1 font-mono text-sm text-myth-ink-faint">{campaignId}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-myth-ink-muted">Title</label>
            <input
              type="text"
              value={campaign.title}
              onChange={(e) => onCampaignChange({ ...campaign, title: e.target.value })}
              className="mt-1 block w-full rounded-md border border-myth-border bg-myth-surface px-3 py-2 text-sm text-myth-ink focus:border-myth-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-myth-ink-muted">Description</label>
            <textarea
              value={campaign.description || ''}
              onChange={(e) => onCampaignChange({ ...campaign, description: e.target.value })}
              rows={3}
              className="mt-1 block w-full rounded-md border border-myth-border bg-myth-surface px-3 py-2 text-sm text-myth-ink focus:border-myth-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-myth-ink-muted">Universe</label>
            <input
              type="text"
              value={campaign.universe || ''}
              onChange={(e) => onCampaignChange({ ...campaign, universe: e.target.value })}
              className="mt-1 block w-full rounded-md border border-myth-border bg-myth-surface px-3 py-2 text-sm text-myth-ink focus:border-myth-accent focus:outline-none"
            />
          </div>
          <button
            onClick={onSaveCampaignInfo}
            disabled={saving}
            className="rounded-md bg-myth-accent px-4 py-2 text-sm font-medium text-myth-accent-ink transition-colors hover:bg-myth-accent-hover disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Campaign Information'}
          </button>
        </div>
      </section>

      {worldMeta && pacing && (
        <section>
          <SectionHeader title="World Turn Pacing" as="h2" />
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
      )}

      <section>
        <SectionHeader title="World Summary" as="h2" />
        <div className="mt-3">
          <WorldStateDashboard npcs={npcs} factions={factions} clocks={clocks} worldNotes={worldNotes} />
        </div>
      </section>
    </div>
  )
}
