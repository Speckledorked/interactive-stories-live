'use client'

import { useState } from 'react'
import { authenticatedFetch } from '@/lib/clientAuth'
import { Badge } from '@/components/ui/badge'
import { SectionHeader } from '@/components/ui/section-header'

interface TickChange {
  entityName: string
  field: string
  previousValue?: string | number | null
  newValue?: string | number | null
  reason: string
  importance: string
  significant?: boolean
}

interface WorldEvent {
  id: string
  turnNumber: number
  targetName: string
  field: string
  previousValue?: string | number | null
  newValue?: string | number | null
  reason: string
  origin: string
}

export function DataAdvancedPanel({
  campaignId,
  campaignTitle,
  tickPreview,
  tickPreviewLoading,
  onPreviewTick,
  worldEvents,
  worldEventsLoading,
  worldEventsTurn,
  onWorldEventsTurnChange,
  onLoadWorldEvents,
  saving,
  onDeleteCampaign,
}: {
  campaignId: string
  campaignTitle: string
  tickPreview: TickChange[] | null
  tickPreviewLoading: boolean
  onPreviewTick: () => void
  worldEvents: WorldEvent[]
  worldEventsLoading: boolean
  worldEventsTurn: number | null
  onWorldEventsTurnChange: (turn: number | null) => void
  onLoadWorldEvents: () => void
  saving: boolean
  onDeleteCampaign: () => void
}) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  return (
    <div className="space-y-8">
      {/* Export & Backup */}
      <section>
        <SectionHeader title="Export & Backup" action={<Badge variant="recommended">Recommended</Badge>} />
        <div className="mt-3 rounded-lg border border-myth-border bg-myth-surface p-5">
          <p className="mb-4 text-sm text-myth-ink-muted">Download your campaign data for backup or to move to another platform.</p>
          <button
            onClick={async () => {
              try {
                const response = await authenticatedFetch(`/api/campaigns/${campaignId}/export`)
                if (response.ok) {
                  const blob = await response.blob()
                  const url = window.URL.createObjectURL(blob)
                  const link = document.createElement('a')
                  link.href = url
                  link.download = `campaign-${campaignId}-${Date.now()}.json`
                  document.body.appendChild(link)
                  link.click()
                  document.body.removeChild(link)
                  window.URL.revokeObjectURL(url)
                } else {
                  alert('Export failed. Please try again.')
                }
              } catch (error) {
                console.error('Export error:', error)
                alert('Export failed. Please try again.')
              }
            }}
            className="rounded-md border border-myth-border px-4 py-2 text-sm text-myth-ink-muted transition-colors hover:border-myth-border-strong hover:text-myth-ink"
          >
            Export Campaign (JSON)
          </button>
        </div>
      </section>

      {/* Debug — collapsed behind a disclosure */}
      <section>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-2 text-sm text-myth-ink-muted hover:text-myth-ink"
        >
          {showAdvanced ? 'Hide advanced tools' : 'Show advanced tools'}
          <Badge variant="advanced">Advanced</Badge>
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-4">
            <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
              <h3 className="font-medium text-myth-ink">Preview Next Tick</h3>
              <p className="mb-4 mt-1 text-xs text-myth-ink-faint">
                Dry-runs the world tick against current state — shows exactly what would change and why, without
                writing anything or advancing the turn.
              </p>
              <button
                onClick={onPreviewTick}
                disabled={tickPreviewLoading}
                className="rounded-md border border-myth-border px-4 py-2 text-sm text-myth-ink-muted transition-colors hover:border-myth-border-strong hover:text-myth-ink disabled:opacity-50"
              >
                {tickPreviewLoading ? 'Simulating...' : 'Preview Next Tick'}
              </button>

              {tickPreview !== null && (
                <div className="mt-4 space-y-2">
                  {tickPreview.length === 0 ? (
                    <p className="text-sm italic text-myth-ink-faint">No changes — the next tick would be a no-op.</p>
                  ) : (
                    tickPreview.map((change, i) => (
                      <div key={i} className="rounded-md border border-myth-border p-3">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-sm font-medium text-myth-ink">
                            {change.entityName} · {change.field}
                          </span>
                          <span className="rounded-full bg-myth-ink/5 px-2 py-0.5 text-xs text-myth-ink-muted">
                            {change.importance}
                          </span>
                        </div>
                        <p className="text-xs text-myth-ink-muted">
                          <span className="text-myth-ink-faint">{change.previousValue ?? '—'}</span>
                          {' → '}
                          <span className="text-myth-ink">{change.newValue ?? '—'}</span>
                        </p>
                        <p className="mt-1 text-xs italic text-myth-ink-faint">{change.reason}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
              <h3 className="font-medium text-myth-ink">Tick Log</h3>
              <p className="mb-4 mt-1 text-xs text-myth-ink-faint">
                Every deterministic tick change and player-action consequence, with the reason the simulation made
                that call. Leave the turn blank for the most recent events across all turns.
              </p>
              <div className="mb-4 flex items-end gap-3">
                <div>
                  <label className="mb-1 block text-sm text-myth-ink-muted">Turn</label>
                  <input
                    type="number"
                    min={1}
                    placeholder="latest"
                    value={worldEventsTurn ?? ''}
                    onChange={(e) => onWorldEventsTurnChange(e.target.value === '' ? null : parseInt(e.target.value))}
                    className="block w-28 rounded-md border border-myth-border bg-myth-surface px-3 py-2 text-sm text-myth-ink focus:border-myth-accent focus:outline-none"
                  />
                </div>
                <button
                  onClick={onLoadWorldEvents}
                  disabled={worldEventsLoading}
                  className="rounded-md border border-myth-border px-4 py-2 text-sm text-myth-ink-muted transition-colors hover:border-myth-border-strong hover:text-myth-ink disabled:opacity-50"
                >
                  {worldEventsLoading ? 'Loading...' : 'Load'}
                </button>
              </div>

              {worldEventsLoading ? (
                <p className="text-sm text-myth-ink-faint">Loading...</p>
              ) : worldEvents.length === 0 ? (
                <p className="text-sm italic text-myth-ink-faint">No events found.</p>
              ) : (
                <div className="space-y-2">
                  {worldEvents.map((event) => (
                    <div key={event.id} className="rounded-md border border-myth-border p-3">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-sm font-medium text-myth-ink">
                          Turn {event.turnNumber} · {event.targetName}
                        </span>
                        <span className="text-xs text-myth-ink-faint">{event.origin}</span>
                      </div>
                      <p className="text-xs text-myth-ink-muted">
                        {event.field}: <span className="text-myth-ink-faint">{event.previousValue ?? '—'}</span>
                        {' → '}
                        <span className="text-myth-ink">{event.newValue ?? '—'}</span>
                      </p>
                      <p className="mt-1 text-xs italic text-myth-ink-faint">{event.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Danger Zone — always last, visually isolated */}
      <section className="mt-12 border-t-2 border-red-700/40 pt-6">
        <SectionHeader title="Danger Zone" action={<Badge variant="dangerous">Dangerous</Badge>} />
        <div className="mt-3 rounded-lg border border-red-700/40 p-5">
          <p className="mb-4 text-sm text-myth-ink-muted">
            This permanently removes every character, scene, and recorded event in {campaignTitle}. There is no undo.
          </p>

          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="rounded-md bg-red-700 px-4 py-2 text-sm text-white transition-colors hover:bg-red-800"
            >
              Delete Campaign
            </button>
          ) : (
            <div className="space-y-3">
              <label className="block text-sm text-myth-ink-muted">
                Type <span className="font-mono font-medium text-myth-ink">{campaignTitle}</span> to confirm
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="block w-full max-w-sm rounded-md border border-myth-border bg-myth-surface px-3 py-2 text-sm text-myth-ink focus:border-red-600 focus:outline-none"
                placeholder={campaignTitle}
              />
              <div className="flex gap-2">
                <button
                  onClick={onDeleteCampaign}
                  disabled={saving || confirmText !== campaignTitle}
                  className="rounded-md bg-red-700 px-4 py-2 text-sm text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving ? 'Deleting...' : 'Yes, Delete Campaign'}
                </button>
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false)
                    setConfirmText('')
                  }}
                  disabled={saving}
                  className="rounded-md border border-myth-border px-4 py-2 text-sm text-myth-ink-muted transition-colors hover:border-myth-border-strong hover:text-myth-ink disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
