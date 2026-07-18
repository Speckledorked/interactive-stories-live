import { SectionHeader } from '@/components/ui/section-header'
import { SetupChecklist, type SetupChecklistItem } from '@/components/admin/SetupChecklist'
import WorldStateDashboard from '@/components/admin/WorldStateDashboard'

interface CampaignIdentity {
  title: string
  description: string | null
  universe: string | null
}

export function AdminOverviewPanel({
  campaignId,
  campaign,
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
  onCampaignChange: (campaign: CampaignIdentity) => void
  onSaveCampaignInfo: () => void
  saving: boolean
  checklistItems: SetupChecklistItem[]
  npcs: Array<{ id: string; name: string; role: string; status: 'alive' | 'dead'; relationship?: 'friendly' | 'neutral' | 'hostile'; lastSeen: string }>
  factions: Array<{ id: string; name: string; influence: number; relationship: 'hostile' | 'neutral' | 'allied'; description: string }>
  clocks: Array<{ id: string; name: string; current: number; max: number }>
  worldNotes: string[]
}) {
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

      <section>
        <SectionHeader title="World Summary" as="h2" />
        <div className="mt-3">
          <WorldStateDashboard npcs={npcs} factions={factions} clocks={clocks} worldNotes={worldNotes} />
        </div>
      </section>
    </div>
  )
}
