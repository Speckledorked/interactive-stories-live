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
import { SectionHeader } from '@/components/ui/section-header'
import { HEADER_OFFSET } from '@/components/tavern/headerOffset'

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
interface UserCampaignListingEntry {
  userId: string
  email: string
  name: string | null
  createdAt: string
  campaigns: Array<{ id: string; title: string; createdAt: string }>
}
interface CampaignCostEntry {
  campaignId: string
  title: string
  totalCostDollars: number
  totalPaidDollars: number
  requestCount: number
}
interface CampaignCostSummary {
  totalCostDollars: number
  totalPaidDollars: number
  totalRequests: number
  topCampaigns: CampaignCostEntry[]
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
  users: UserCampaignListingEntry[]
  campaignCosts: CampaignCostSummary
  aiCostByDay: Array<{ date: string; costDollars: number }>
}

function StatTile({ label, value, sublabel }: { label: string; value: string | number; sublabel?: string }) {
  return (
    <div className="rounded-lg border border-myth-border bg-myth-surface p-4">
      <p className="mb-1 text-xs text-myth-ink-faint">{label}</p>
      <p className="text-2xl font-bold text-myth-ink">{value}</p>
      {sublabel && <p className="mt-1 text-xs text-myth-ink-faint">{sublabel}</p>}
    </div>
  )
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return '—'
  return `${Math.round((numerator / denominator) * 100)}%`
}

function formatCost(dollars: number): string {
  return `$${dollars.toFixed(dollars < 10 ? 4 : 2)}`
}

function RetentionCell({ metric, cohortSize }: { metric: CohortMetric; cohortSize: number }) {
  if (!metric.eligible) {
    return <span className="text-myth-ink-faint">pending</span>
  }
  return <span className="text-myth-ink-muted">{pct(metric.retained, cohortSize)}</span>
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
  const maxDailyCost = data ? Math.max(0.01, ...data.aiCostByDay.map(d => d.costDollars)) : 0.01

  return (
    <TavernPage>
      <TavernHeader backHref="/campaigns" title="Alpha Instrumentation" />

      <main className={`max-w-5xl mx-auto px-4 ${HEADER_OFFSET} pb-28`}>
        {loading && (
          <div className="flex justify-center py-16">
            <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-myth-accent" />
          </div>
        )}

        {forbidden && (
          <div className="rounded-lg border border-myth-danger/30 bg-myth-danger/10 p-6 text-center">
            <p className="mb-1 font-semibold text-myth-ink">Not authorized</p>
            <p className="text-sm text-myth-ink-muted">This dashboard is restricted to platform operators.</p>
          </div>
        )}

        {error && <p className="mb-4 text-sm text-myth-danger">{error}</p>}

        {data && (
          <div className="space-y-8">
            {/* Funnel */}
            <section>
              <SectionHeader as="h2" title="Activation Funnel" />
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3">
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
              <SectionHeader as="h2" title="Signups (last 30 days)" />
              <div className="mt-3 rounded-lg border border-myth-border bg-myth-surface p-4">
                <div className="flex h-24 items-end gap-0.5">
                  {data.signupsByDay.map(d => (
                    <div
                      key={d.date}
                      className="min-h-[2px] flex-1 rounded-t bg-myth-accent/50 transition-colors hover:bg-myth-accent"
                      style={{ height: `${(d.count / maxDaily) * 100}%` }}
                      title={`${d.date}: ${d.count}`}
                    />
                  ))}
                </div>
                <p className="mt-2 text-xs text-myth-ink-faint">
                  {data.signupsByDay.reduce((sum, d) => sum + d.count, 0)} total · hover a bar for the day
                </p>
              </div>
            </section>

            {/* Retention */}
            <section>
              <SectionHeader as="h2" title="Retention by Signup Cohort (weekly, UTC)" />
              <div className="mt-3 overflow-x-auto rounded-lg border border-myth-border bg-myth-surface p-4">
                {data.retention.length === 0 ? (
                  <p className="text-sm text-myth-ink-faint">No signups in the last 8 weeks yet.</p>
                ) : (
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-myth-ink-faint">
                        <th className="pb-2 pr-4">Week of</th>
                        <th className="pb-2 pr-4">Cohort</th>
                        <th className="pb-2 pr-4">D1</th>
                        <th className="pb-2 pr-4">D7</th>
                        <th className="pb-2">D28</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.retention].reverse().map(row => (
                        <tr key={row.weekStart} className="border-t border-myth-border">
                          <td className="py-2 pr-4 text-myth-ink">{row.weekStart}</td>
                          <td className="py-2 pr-4 text-myth-ink-muted">{row.cohortSize}</td>
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
              <SectionHeader as="h2" title="Stuck / Abandoned Jobs (recent)" />
              <div className="mt-3 rounded-lg border border-myth-border bg-myth-surface p-4">
                {data.stuckResolutionJobs.length === 0 && data.stuckLoreJobs.length === 0 ? (
                  <p className="text-sm text-myth-ink-faint">Nothing stuck recently — the recovery sweeps are keeping up.</p>
                ) : (
                  <div className="space-y-2">
                    {data.stuckResolutionJobs.map(job => (
                      <div key={job.id} className="rounded-lg border border-myth-border bg-myth-surface-sunken p-2.5 text-xs">
                        <span className="font-mono text-myth-ink-faint">scene resolution</span>{' '}
                        <span className="text-myth-ink">{job.status}</span>{' '}
                        <span className="text-myth-ink-faint">campaign {job.campaignId}</span>
                        {job.lastError && <p className="mt-1 text-myth-danger">{job.lastError}</p>}
                      </div>
                    ))}
                    {data.stuckLoreJobs.map(job => (
                      <div key={job.id} className="rounded-lg border border-myth-border bg-myth-surface-sunken p-2.5 text-xs">
                        <span className="font-mono text-myth-ink-faint">lore import</span>{' '}
                        <span className="text-myth-ink">{job.status}</span>{' '}
                        <span className="text-myth-ink-faint">campaign {job.campaignId}</span>
                        {job.lastError && <p className="mt-1 text-myth-danger">{job.lastError}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Users & campaigns (#99) — metadata only: who's here, and what
                they've created. "Created" is read off ADMIN campaign
                membership, since there's no separate creator field. */}
            <section>
              <SectionHeader
                as="h2"
                title="Users & Campaigns"
                description={`Most recently joined ${data.users.length} user${data.users.length === 1 ? '' : 's'}, and the campaigns each one administers.`}
              />
              <div className="mt-3 overflow-x-auto rounded-lg border border-myth-border bg-myth-surface">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-myth-border text-left text-xs text-myth-ink-faint">
                      <th className="px-3 py-2 font-medium">User</th>
                      <th className="px-3 py-2 font-medium">Joined</th>
                      <th className="px-3 py-2 font-medium">Campaigns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((u) => (
                      <tr key={u.userId} className="border-b border-myth-border last:border-0 align-top">
                        <td className="px-3 py-2">
                          <p className="text-myth-ink">{u.name || u.email}</p>
                          {u.name && <p className="text-xs text-myth-ink-faint">{u.email}</p>}
                        </td>
                        <td className="px-3 py-2 text-xs text-myth-ink-faint whitespace-nowrap">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2">
                          {u.campaigns.length === 0 ? (
                            <span className="text-xs text-myth-ink-faint">none</span>
                          ) : (
                            <ul className="space-y-0.5">
                              {u.campaigns.map((c) => (
                                <li key={c.id} className="text-xs text-myth-ink-muted">{c.title}</li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* AI cost by campaign — every AI call already writes a real
                AICostEntry row (spent), and every scene-resolution billing
                charge already writes a real Transaction (paid); this is the
                first place either is actually surfaced, platform-wide (not
                scoped to admin-owned campaigns like the table above — spend
                and revenue matter regardless of who administers a
                campaign). */}
            <section>
              <SectionHeader
                as="h2"
                title="AI Cost by Campaign"
                description="What each campaign's AI usage actually cost us, vs. what's been billed and collected from players."
              />
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatTile label="Total spent" value={formatCost(data.campaignCosts.totalCostDollars)} sublabel="raw AI cost" />
                <StatTile label="Total paid" value={formatCost(data.campaignCosts.totalPaidDollars)} sublabel="billed to players" />
                <StatTile label="Total AI requests" value={data.campaignCosts.totalRequests} />
              </div>

              {/* Daily spend trend (#260) — the flat list below answers
                  "who's expensive"; this answers "is spend trending up",
                  platform-wide across all campaigns, same 30-day window
                  as the signups chart above. */}
              <div className="mt-3 rounded-lg border border-myth-border bg-myth-surface p-4">
                <p className="mb-2 text-xs uppercase tracking-wide text-myth-ink-faint">Daily AI spend (last 30 days)</p>
                <div className="flex h-24 items-end gap-0.5">
                  {data.aiCostByDay.map(d => (
                    <div
                      key={d.date}
                      className="min-h-[2px] flex-1 rounded-t bg-myth-accent/50 transition-colors hover:bg-myth-accent"
                      style={{ height: `${(d.costDollars / maxDailyCost) * 100}%` }}
                      title={`${d.date}: ${formatCost(d.costDollars)}`}
                    />
                  ))}
                </div>
                <p className="mt-2 text-xs text-myth-ink-faint">
                  {formatCost(data.aiCostByDay.reduce((sum, d) => sum + d.costDollars, 0))} over this window · hover a bar for the day
                </p>
              </div>

              <div className="mt-3 overflow-x-auto rounded-lg border border-myth-border bg-myth-surface">
                {data.campaignCosts.topCampaigns.length === 0 ? (
                  <p className="p-4 text-sm text-myth-ink-faint">No AI cost recorded yet.</p>
                ) : (
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="border-b border-myth-border text-left text-xs text-myth-ink-faint">
                        <th className="px-3 py-2 font-medium">Campaign</th>
                        <th className="px-3 py-2 font-medium">Spent</th>
                        <th className="px-3 py-2 font-medium">Paid</th>
                        <th className="px-3 py-2 font-medium">AI requests</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.campaignCosts.topCampaigns.map((c) => (
                        <tr key={c.campaignId} className="border-b border-myth-border last:border-0">
                          <td className="px-3 py-2 text-myth-ink">{c.title}</td>
                          <td className="px-3 py-2 text-myth-ink-muted">{formatCost(c.totalCostDollars)}</td>
                          <td className="px-3 py-2 text-myth-ink-muted">{formatCost(c.totalPaidDollars)}</td>
                          <td className="px-3 py-2 text-myth-ink-faint">{c.requestCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </TavernPage>
  )
}
