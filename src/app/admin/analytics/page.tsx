// src/app/admin/analytics/page.tsx
// #12 alpha instrumentation dashboard — platform-wide, not per-campaign.
// Gated server-side by PLATFORM_ADMIN_EMAILS (api/admin/analytics returns
// 403 for anyone else); this page just renders whatever it gets back and
// shows an access-denied state on 403/401.

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authenticatedFetch, isAuthenticated } from '@/lib/clientAuth'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernSpinner } from '@/components/tavern/ui'

interface CohortMetric {
  retained: number
  eligible: boolean
}
interface CohortRetention {
  weekStart: string
  cohortSize: number
  d1: CohortMetric
  d7: CohortMetric
  d28: CohortMetric
}
interface StuckJob {
  id: string
  campaignId: string
  status: string
  lastError: string | null
  updatedAt: string
  alertedStuckAt: string | null
  sceneId?: string
  sourceType?: string
}
interface AnalyticsData {
  funnel: {
    signups: number
    campaignsCreated: number
    charactersCreated: number
    scenesStarted: number
    actionsSubmitted: number
  }
  signupsByDay: Array<{ date: string; count: number }>
  retention: CohortRetention[]
  stuckResolutionJobs: StuckJob[]
  stuckLoreJobs: StuckJob[]
}

function StatTile({ label, value, sublabel }: { label: string; value: string | number; sublabel?: string }) {
  return (
    <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-4">
      <p className="text-xs text-ember-300/50 mb-1">{label}</p>
      <p className="text-2xl font-bold text-ember-100">{value}</p>
      {sublabel && <p className="text-xs text-ember-400/40 mt-1">{sublabel}</p>}
    </div>
  )
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return '—'
  return `${Math.round((numerator / denominator) * 100)}%`
}

function RetentionCell({ metric, cohortSize }: { metric: CohortMetric; cohortSize: number }) {
  if (!metric.eligible) {
    return <span className="text-ember-500/30">pending</span>
  }
  return <span className="text-ember-200">{pct(metric.retained, cohortSize)}</span>
}

export default function AnalyticsDashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }
    load()
  }, [])

  const load = async () => {
    try {
      const res = await authenticatedFetch('/api/admin/analytics')
      if (res.status === 401 || res.status === 403) {
        setForbidden(true)
        return
      }
      if (!res.ok) throw new Error('Failed to load analytics')
      setData(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }

  const maxDaily = data ? Math.max(1, ...data.signupsByDay.map(d => d.count)) : 1

  return (
    <TavernPage>
      <TavernHeader backHref="/campaigns" title="Alpha Instrumentation" />

      <main className="max-w-5xl mx-auto px-4 pt-28 pb-28">
        {loading && (
          <div className="flex justify-center py-16">
            <TavernSpinner />
          </div>
        )}

        {forbidden && (
          <div className="rounded-xl bg-wine-900/30 border border-wine-700/40 p-6 text-center">
            <p className="text-ember-100 font-semibold mb-1">Not authorized</p>
            <p className="text-sm text-ember-300/60">This dashboard is restricted to platform operators.</p>
          </div>
        )}

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        {data && (
          <div className="space-y-8">
            {/* Funnel */}
            <section>
              <h2 className="text-sm font-bold text-ember-300/60 mb-3 uppercase tracking-wide">Activation Funnel</h2>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <StatTile label="Signed up" value={data.funnel.signups} />
                <StatTile
                  label="Created a campaign"
                  value={data.funnel.campaignsCreated}
                  sublabel={pct(data.funnel.campaignsCreated, data.funnel.signups)}
                />
                <StatTile
                  label="Created a character"
                  value={data.funnel.charactersCreated}
                  sublabel={pct(data.funnel.charactersCreated, data.funnel.signups)}
                />
                <StatTile
                  label="Started a scene"
                  value={data.funnel.scenesStarted}
                  sublabel={pct(data.funnel.scenesStarted, data.funnel.signups)}
                />
                <StatTile
                  label="Submitted an action"
                  value={data.funnel.actionsSubmitted}
                  sublabel={pct(data.funnel.actionsSubmitted, data.funnel.signups)}
                />
              </div>
            </section>

            {/* Signups by day */}
            <section>
              <h2 className="text-sm font-bold text-ember-300/60 mb-3 uppercase tracking-wide">Signups (last 30 days)</h2>
              <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-4">
                <div className="flex items-end gap-0.5 h-24">
                  {data.signupsByDay.map(d => (
                    <div
                      key={d.date}
                      className="flex-1 bg-ember-700/50 hover:bg-ember-500/60 rounded-t transition-colors min-h-[2px]"
                      style={{ height: `${(d.count / maxDaily) * 100}%` }}
                      title={`${d.date}: ${d.count}`}
                    />
                  ))}
                </div>
                <p className="text-xs text-ember-400/40 mt-2">
                  {data.signupsByDay.reduce((sum, d) => sum + d.count, 0)} total · hover a bar for the day
                </p>
              </div>
            </section>

            {/* Retention */}
            <section>
              <h2 className="text-sm font-bold text-ember-300/60 mb-3 uppercase tracking-wide">
                Retention by Signup Cohort (weekly, UTC)
              </h2>
              <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-4 overflow-x-auto">
                {data.retention.length === 0 ? (
                  <p className="text-sm text-ember-400/50">No signups in the last 8 weeks yet.</p>
                ) : (
                  <table className="w-full text-sm min-w-[420px]">
                    <thead>
                      <tr className="text-left text-ember-400/50 text-xs uppercase">
                        <th className="pb-2 pr-4">Week of</th>
                        <th className="pb-2 pr-4">Cohort</th>
                        <th className="pb-2 pr-4">D1</th>
                        <th className="pb-2 pr-4">D7</th>
                        <th className="pb-2">D28</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.retention].reverse().map(row => (
                        <tr key={row.weekStart} className="border-t border-ember-900/20">
                          <td className="py-2 pr-4 text-ember-200">{row.weekStart}</td>
                          <td className="py-2 pr-4 text-ember-300/70">{row.cohortSize}</td>
                          <td className="py-2 pr-4"><RetentionCell metric={row.d1} cohortSize={row.cohortSize} /></td>
                          <td className="py-2 pr-4"><RetentionCell metric={row.d7} cohortSize={row.cohortSize} /></td>
                          <td className="py-2"><RetentionCell metric={row.d28} cohortSize={row.cohortSize} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {/* Stuck jobs */}
            <section>
              <h2 className="text-sm font-bold text-ember-300/60 mb-3 uppercase tracking-wide">
                Stuck / Abandoned Jobs (recent)
              </h2>
              <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-4">
                {data.stuckResolutionJobs.length === 0 && data.stuckLoreJobs.length === 0 ? (
                  <p className="text-sm text-ember-400/50">Nothing stuck recently — the recovery sweeps are keeping up.</p>
                ) : (
                  <div className="space-y-2">
                    {data.stuckResolutionJobs.map(job => (
                      <div key={job.id} className="text-xs p-2.5 rounded-lg bg-black/25 border border-ember-900/30">
                        <span className="font-mono text-ember-400/60">scene resolution</span>{' '}
                        <span className="text-ember-200">{job.status}</span>{' '}
                        <span className="text-ember-400/50">campaign {job.campaignId}</span>
                        {job.lastError && <p className="text-red-400/80 mt-1">{job.lastError}</p>}
                      </div>
                    ))}
                    {data.stuckLoreJobs.map(job => (
                      <div key={job.id} className="text-xs p-2.5 rounded-lg bg-black/25 border border-ember-900/30">
                        <span className="font-mono text-ember-400/60">lore import</span>{' '}
                        <span className="text-ember-200">{job.status}</span>{' '}
                        <span className="text-ember-400/50">campaign {job.campaignId}</span>
                        {job.lastError && <p className="text-red-400/80 mt-1">{job.lastError}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </TavernPage>
  )
}
