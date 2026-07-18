// src/components/admin/LoreManagerPanel.tsx
// Admin UI for importing reference lore: paste raw text, import a single
// page by URL, or crawl an entire MediaWiki-based wiki (Fandom, wiki.gg,
// Wikipedia, etc — see lib/lore/mediaWikiClient.ts; non-MediaWiki sites
// fall back to being imported as a single page). Each import runs as a
// background job (lib/lore/loreQueue.ts); this panel polls for progress.

'use client'

import { useEffect, useRef, useState } from 'react'
import { authenticatedFetch } from '@/lib/clientAuth'

type SourceType = 'PASTE' | 'URL' | 'WIKI'
type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'

interface LoreJob {
  id: string
  sourceType: SourceType
  sourceUrl: string | null
  sourceTitle: string | null
  status: JobStatus
  lastError: string | null
  pagesFound: number
  pagesDone: number
  entriesCreated: number
  createdAt: string
  finishedAt: string | null
}

interface ReseedSummary {
  fresh: boolean
  loreEntriesSampled: number
  loreEntriesTotal: number
  factionsAdded: string[]
  factionsRetired: string[]
  factionsAlreadyPresent: number
  capabilitiesAdded: string[]
  frontsAdded: string[]
  npcsAdded: string[]
  locationsAdded: string[]
  statLabelsSet: boolean
  corruptionThemeSet: boolean
  archetypesReplaced: number
  archetypesSkipped: boolean
}

interface ReseedJob {
  id: string
  status: JobStatus
  lastError: string | null
  summary: ReseedSummary | null
  createdAt: string
  finishedAt: string | null
}

function formatReseedSummary(s: ReseedSummary): string {
  const parts: string[] = []
  if (s.fresh) parts.push('Fresh campaign — generated world replaced by canon')
  parts.push(
    s.factionsAdded.length > 0
      ? `Added ${s.factionsAdded.length} faction${s.factionsAdded.length === 1 ? '' : 's'}: ${s.factionsAdded.join(', ')}`
      : 'No new factions (canon ones may already exist)'
  )
  if (s.factionsRetired?.length > 0) {
    parts.push(`Retired ${s.factionsRetired.length} non-canon faction${s.factionsRetired.length === 1 ? '' : 's'}: ${s.factionsRetired.join(', ')}`)
  }
  parts.push(
    s.capabilitiesAdded.length > 0
      ? `Added ${s.capabilitiesAdded.length} learnable system${s.capabilitiesAdded.length === 1 ? '' : 's'}: ${s.capabilitiesAdded.join(', ')}`
      : 'No new learnable systems'
  )
  if (s.frontsAdded?.length > 0) {
    parts.push(`Added ${s.frontsAdded.length} front-style threat${s.frontsAdded.length === 1 ? '' : 's'}: ${s.frontsAdded.join(', ')}`)
  }
  if (s.npcsAdded?.length > 0) {
    parts.push(`Added ${s.npcsAdded.length} NPC${s.npcsAdded.length === 1 ? '' : 's'}: ${s.npcsAdded.join(', ')}`)
  }
  if (s.locationsAdded?.length > 0) {
    parts.push(`Added ${s.locationsAdded.length} location${s.locationsAdded.length === 1 ? '' : 's'}: ${s.locationsAdded.join(', ')}`)
  }
  if (s.statLabelsSet) parts.push('Stat labels set from canon')
  if (s.corruptionThemeSet) parts.push('Corruption theme set from canon')
  if (s.archetypesReplaced > 0) parts.push(`${s.archetypesReplaced} origin archetypes regenerated from canon`)
  parts.push(`(grounded in ${s.loreEntriesSampled} of ${s.loreEntriesTotal} imported lore entries)`)
  return parts.join('. ')
}

const SOURCE_TABS: Array<{ value: SourceType; label: string }> = [
  { value: 'PASTE', label: 'Paste Text' },
  { value: 'URL', label: 'Single Page' },
  { value: 'WIKI', label: 'Whole Wiki' },
]

const POLL_INTERVAL_MS = 4000

export default function LoreManagerPanel({ campaignId }: { campaignId: string }) {
  const [jobs, setJobs] = useState<LoreJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [sourceType, setSourceType] = useState<SourceType>('PASTE')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchJobs = async () => {
    try {
      const res = await authenticatedFetch(`/api/campaigns/${campaignId}/lore`)
      if (!res.ok) throw new Error('Failed to load lore sources')
      const data = await res.json()
      setJobs(data.jobs || [])
      setError(null)
    } catch (err) {
      setError('Failed to load lore sources')
    } finally {
      setLoading(false)
    }
  }

  const [reseedJob, setReseedJob] = useState<ReseedJob | null>(null)
  const reseedPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchReseedJob = async () => {
    try {
      const res = await authenticatedFetch(`/api/campaigns/${campaignId}/reseed-from-lore`)
      if (!res.ok) return
      const data = await res.json()
      setReseedJob(data.job || null)
    } catch {
      // best-effort — the poll loop (or the next page load) will retry
    }
  }

  useEffect(() => {
    fetchJobs()
    fetchReseedJob()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId])

  useEffect(() => {
    const hasLiveJob = jobs.some(j => j.status === 'PENDING' || j.status === 'RUNNING')
    if (hasLiveJob && !pollRef.current) {
      pollRef.current = setInterval(fetchJobs, POLL_INTERVAL_MS)
    } else if (!hasLiveJob && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs])

  useEffect(() => {
    const isLive = reseedJob?.status === 'PENDING' || reseedJob?.status === 'RUNNING'
    if (isLive && !reseedPollRef.current) {
      reseedPollRef.current = setInterval(fetchReseedJob, POLL_INTERVAL_MS)
    } else if (!isLive && reseedPollRef.current) {
      clearInterval(reseedPollRef.current)
      reseedPollRef.current = null
    }
    return () => {
      if (reseedPollRef.current) {
        clearInterval(reseedPollRef.current)
        reseedPollRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reseedJob?.status])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (sourceType === 'PASTE' && !text.trim()) {
      setFormError('Paste some text to import.')
      return
    }
    if (sourceType !== 'PASTE' && !url.trim()) {
      setFormError('Enter a URL to import.')
      return
    }

    setSubmitting(true)
    try {
      const res = await authenticatedFetch(`/api/campaigns/${campaignId}/lore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType,
          sourceTitle: title.trim() || undefined,
          ...(sourceType === 'PASTE' ? { rawText: text } : { sourceUrl: url.trim() }),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start import')

      setTitle('')
      setText('')
      setUrl('')
      await fetchJobs()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to start import')
    } finally {
      setSubmitting(false)
    }
  }

  const [reseedStarting, setReseedStarting] = useState(false)
  const [reseedStartError, setReseedStartError] = useState<string | null>(null)

  const reseedInFlight = reseedStarting || reseedJob?.status === 'PENDING' || reseedJob?.status === 'RUNNING'

  const handleReseed = async () => {
    if (!confirm(
      'Regenerate the world\'s structure from imported lore?\n\n' +
      'While the campaign has no characters yet, the generated world is REPLACED ' +
      'by the canon one (non-canon factions are retired). Once characters exist, ' +
      'canon factions and systems are only ADDED — nothing in play is touched.'
    )) return
    setReseedStarting(true)
    setReseedStartError(null)
    try {
      const res = await authenticatedFetch(`/api/campaigns/${campaignId}/reseed-from-lore`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start reseed')
      setReseedJob(data.job)
    } catch (err) {
      setReseedStartError(err instanceof Error ? err.message : 'Failed to start reseed')
    } finally {
      setReseedStarting(false)
    }
  }

  const handleDelete = async (jobId: string) => {
    if (!confirm('Delete this lore source and everything imported from it?')) return
    try {
      const res = await authenticatedFetch(`/api/campaigns/${campaignId}/lore/${jobId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      await fetchJobs()
    } catch (err) {
      setError('Failed to delete lore source')
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-myth-border bg-myth-surface p-4">
        <h3 className="mb-3 font-medium text-myth-ink">Import Lore</h3>
        <p className="mb-3 text-xs text-myth-ink-muted">
          Reference material the AI GM can draw on during play — a world bible, faction writeups, a wiki page,
          or an entire fan wiki. Wiki crawling only works for MediaWiki-based sites (Fandom, wiki.gg, Wikipedia, etc);
          give it any page URL on the wiki and it finds the rest itself.
        </p>

        <div className="mb-3 flex gap-2">
          {SOURCE_TABS.map(tab => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setSourceType(tab.value)}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                sourceType === tab.value
                  ? 'border-myth-accent bg-myth-accent/10 text-myth-accent'
                  : 'border-myth-border text-myth-ink-muted hover:text-myth-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-myth-ink-muted">Title (optional)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={sourceType === 'PASTE' ? 'e.g. Essence Magic Overview' : undefined}
              className="block w-full rounded-md border border-myth-border bg-myth-surface px-3 py-2 text-myth-ink shadow-sm focus:border-myth-accent focus:outline-none sm:text-sm"
            />
          </div>

          {sourceType === 'PASTE' ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-myth-ink-muted">Text *</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder="Paste any chunk of lore — history, factions, magic systems, character bios..."
                className="block w-full rounded-md border border-myth-border bg-myth-surface px-3 py-2 text-myth-ink shadow-sm focus:border-myth-accent focus:outline-none sm:text-sm"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-myth-ink-muted">
                {sourceType === 'WIKI' ? 'Any page URL on the wiki *' : 'URL *'}
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={sourceType === 'WIKI' ? 'https://example.fandom.com/wiki/Main_Page' : 'https://example.com/article'}
                className="block w-full rounded-md border border-myth-border bg-myth-surface px-3 py-2 text-myth-ink shadow-sm focus:border-myth-accent focus:outline-none sm:text-sm"
              />
            </div>
          )}

          {formError && <p className="text-sm text-myth-danger">{formError}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-myth-accent px-4 py-2 text-myth-accent-ink hover:bg-myth-accent-hover disabled:opacity-50"
          >
            {submitting ? 'Starting import...' : 'Import'}
          </button>
        </form>
      </div>

      <div className="rounded-lg border border-myth-border bg-myth-surface p-4">
        <h3 className="mb-2 font-medium text-myth-ink">World from Lore</h3>
        <p className="mb-3 text-xs text-myth-ink-muted">
          Campaigns created with a lore source do this automatically when the import finishes. Use this button
          to re-run it — after adding more sources, or on a campaign whose lore came later. While no characters
          exist the generated world is replaced by the canon one; once characters exist, canon factions and
          systems are only added alongside what&apos;s already in play.
        </p>
        <button
          type="button"
          onClick={handleReseed}
          disabled={reseedInFlight || jobs.every(j => j.status !== 'COMPLETED')}
          className="rounded-md bg-myth-accent px-4 py-2 text-myth-accent-ink hover:bg-myth-accent-hover disabled:opacity-50"
        >
          {reseedInFlight ? 'Reseeding world…' : 'Reseed world from imported lore'}
        </button>
        {jobs.length > 0 && jobs.every(j => j.status !== 'COMPLETED') && (
          <p className="mt-2 text-xs text-myth-ink-faint">Available once an import has completed.</p>
        )}
        {reseedInFlight && (
          <p className="mt-3 text-xs text-myth-ink-muted">
            Running in the background — this page checks in every few seconds, safe to navigate away and come back.
          </p>
        )}
        {reseedStartError && <p className="mt-3 text-sm text-myth-danger">{reseedStartError}</p>}
        {!reseedInFlight && reseedJob?.status === 'COMPLETED' && reseedJob.summary && (
          <p className="mt-3 text-sm text-myth-good">{formatReseedSummary(reseedJob.summary)}</p>
        )}
        {!reseedInFlight && reseedJob?.status === 'FAILED' && (
          <p className="mt-3 text-sm text-myth-danger">{reseedJob.lastError || 'Reseed failed'}</p>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="font-medium text-myth-ink">Imported Sources</h3>
        {loading && <p className="text-sm text-myth-ink-muted">Loading...</p>}
        {error && <p className="text-sm text-myth-danger">{error}</p>}
        {!loading && jobs.length === 0 && (
          <p className="text-sm text-myth-ink-muted">No lore imported yet.</p>
        )}
        {jobs.map(job => (
          <LoreJobRow key={job.id} job={job} onDelete={() => handleDelete(job.id)} />
        ))}
      </div>
    </div>
  )
}

function LoreJobRow({ job, onDelete }: { job: LoreJob; onDelete: () => void }) {
  const label = job.sourceTitle || job.sourceUrl || 'Pasted text'
  const progressPct = job.pagesFound > 0 ? Math.round((job.pagesDone / job.pagesFound) * 100) : null

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-myth-border p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs uppercase text-myth-ink-faint">{job.sourceType}</span>
          <h4 className="truncate font-medium text-myth-ink">{label}</h4>
          <StatusBadge status={job.status} />
        </div>
        {(job.status === 'PENDING' || job.status === 'RUNNING') && job.sourceType === 'WIKI' && (
          <p className="mt-1 text-xs text-myth-ink-muted">
            {job.pagesFound > 0
              ? `Crawling ${job.pagesDone}/${job.pagesFound} pages${progressPct !== null ? ` (${progressPct}%)` : ''}`
              : 'Finding pages...'}
          </p>
        )}
        {job.status === 'COMPLETED' && (
          <p className="mt-1 text-xs text-myth-ink-muted">
            {job.entriesCreated} {job.entriesCreated === 1 ? 'entry' : 'entries'} imported
            {job.pagesFound > 1 ? ` from ${job.pagesFound} pages` : ''}
          </p>
        )}
        {job.status === 'FAILED' && job.lastError && (
          <p className="mt-1 text-xs text-myth-danger">{job.lastError}</p>
        )}
      </div>
      <button
        onClick={onDelete}
        className="shrink-0 rounded-md border border-myth-border px-3 py-1 text-sm text-myth-ink-muted hover:border-myth-danger/40 hover:text-myth-danger"
      >
        Delete
      </button>
    </div>
  )
}

function StatusBadge({ status }: { status: JobStatus }) {
  const styles: Record<JobStatus, string> = {
    PENDING: 'text-myth-ink-muted border-myth-border',
    RUNNING: 'text-myth-info border-myth-info/40',
    COMPLETED: 'text-myth-good border-myth-good/40',
    FAILED: 'text-myth-danger border-myth-danger/40',
  }
  return (
    <span className={`text-xs border rounded px-1.5 py-0.5 ${styles[status]}`}>
      {status === 'RUNNING' ? 'Importing...' : status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  )
}
