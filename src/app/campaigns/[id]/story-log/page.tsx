'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { BookOpen, Check, ChevronRight, MessageCircle, Share2 } from 'lucide-react'
import { authenticatedFetch, isAuthenticated, setLastCampaignId } from '@/lib/clientAuth'
import { TavernPage } from '@/components/tavern/TavernPage'
import { TavernHeader } from '@/components/tavern/TavernHeader'
import { TavernNav } from '@/components/tavern/TavernNav'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { SpinnerBlock } from '@/components/ui/spinner'
import { CalendarMonthGrid } from '@/components/tavern/CalendarMonthGrid'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { UI_ICONS } from '@/lib/ui/icons'
import { HEADER_OFFSET } from '@/components/tavern/headerOffset'

interface CampaignLogEntry {
  id: string
  sceneId: string | null
  turnNumber: number
  title: string
  summary: string
  highlights: string[]
  entryType: string
  inGameDate: string | null
  duration: string | null
  // Null for every entry written before the in-fiction calendar existed —
  // never backfilled retroactively (see calendarBackfill.ts). Entries like
  // this surface in the "Before your calendar began" section rather than
  // being silently mis-assigned to a day.
  inGameDayNumber: number | null
  createdAt: string
}

interface Rumor {
  id: string
  turnNumber: number | null
  title: string
  summary: string | null
}

interface DayDetail {
  logs: CampaignLogEntry[]
  rumors: Rumor[]
}

interface Campaign {
  id: string
  // `title`, not `name`: this interface said `name`, which the API has
  // never returned, so the header below silently rendered the literal
  // string "Campaign" for every campaign. tsc couldn't catch it because
  // the fetch response is parsed as untyped JSON.
  title: string
  description: string | null
  userRole?: string
}

export default function StoryLogPage() {
  const params = useParams()
  const router = useRouter()
  const campaignId = params?.id as string

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [logs, setLogs] = useState<CampaignLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [regenerating, setRegenerating] = useState(false)
  const [regenerateResult, setRegenerateResult] = useState('')
  // Shareable recap cards build on the existing chronicle share link — a
  // recap can only be shared once the campaign has opted into public
  // sharing at all (see PublicChroniclePanel/chronicle-share route).
  const [chronicleShare, setChronicleShare] = useState<{ enabled: boolean; token: string | null } | null>(null)

  const [selectedDayNumber, setSelectedDayNumber] = useState<number | null>(null)
  const [selectedDayLabel, setSelectedDayLabel] = useState('')
  const [dayDetail, setDayDetail] = useState<DayDetail | null>(null)
  const [dayDetailLoading, setDayDetailLoading] = useState(false)
  const [showPreCalendar, setShowPreCalendar] = useState(false)

  const isAdmin = campaign?.userRole === 'ADMIN'

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }

    if (campaignId) {
      loadStoryLog()
    }
  }, [campaignId])

  const loadStoryLog = async () => {
    try {
      const campaignResponse = await authenticatedFetch(`/api/campaigns/${campaignId}`)
      if (campaignResponse.ok) {
        const campaignData = await campaignResponse.json()
        setCampaign(campaignData.campaign)
        setLastCampaignId(campaignId)
      }

      const logsResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/logs`)
      if (logsResponse.ok) {
        const logsData = await logsResponse.json()
        setLogs((logsData.logs || []).slice().reverse()) // newest first
      } else {
        setError('Failed to load story log')
      }

      // Best-effort — a failure here just means the Share button falls
      // back to its "not shareable yet" state, not a page-level error.
      try {
        const shareResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/chronicle-share`)
        if (shareResponse.ok) {
          setChronicleShare(await shareResponse.json())
        }
      } catch {
        // Non-fatal — see comment above.
      }
    } catch (err) {
      setError('Failed to load story log')
    } finally {
      setLoading(false)
    }
  }

  const handleRegenerate = async () => {
    setRegenerating(true)
    setRegenerateResult('')
    try {
      const response = await authenticatedFetch(`/api/campaigns/${campaignId}/logs/regenerate`, {
        method: 'POST'
      })
      const data = await response.json()
      if (response.ok) {
        setRegenerateResult(
          (data.consolidated > 0 ? `Merged ${data.consolidated} duplicate ${data.consolidated === 1 ? 'entry' : 'entries'}. ` : '') +
          `Regenerated ${data.regenerated} ${data.regenerated === 1 ? 'entry' : 'entries'}` +
          (data.failed > 0 ? `, ${data.failed} failed` : '') +
          (data.remaining > 0 ? ` — ${data.remaining} more left, run again to continue` : '')
        )
        await loadStoryLog()
      } else {
        setRegenerateResult(data.error || 'Failed to regenerate entries')
      }
    } catch (err) {
      setRegenerateResult('Failed to regenerate entries')
    } finally {
      setRegenerating(false)
    }
  }

  const handleSelectDay = async (dayNumber: number, label: string) => {
    setSelectedDayNumber(dayNumber)
    setSelectedDayLabel(label)
    setDayDetailLoading(true)
    setDayDetail(null)
    try {
      const res = await authenticatedFetch(`/api/campaigns/${campaignId}/logs/day?dayNumber=${dayNumber}`)
      if (res.ok) {
        setDayDetail(await res.json())
      }
    } finally {
      setDayDetailLoading(false)
    }
  }

  const preCalendarLogs = logs.filter((log) => log.inGameDayNumber == null)

  if (loading) {
    return (
      <TavernPage>
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Story Log" campaignId={campaignId} />
        <main className={`max-w-4xl mx-auto px-4 ${HEADER_OFFSET} pb-16`}>
          <SpinnerBlock className="h-16 w-16" />
        </main>
      </TavernPage>
    )
  }

  if (error) {
    return (
      <TavernPage>
        <TavernHeader backHref={`/campaigns/${campaignId}`} title="Story Log" campaignId={campaignId} />
        <main className={`max-w-4xl mx-auto px-4 ${HEADER_OFFSET} pb-16`}>
          {/* Tinted ground, not a solid danger fill: this was
              bg-myth-danger with text-myth-danger on top, i.e. the text
              was the same colour as the surface it sat on. */}
          <Card className="border-myth-danger/40 bg-myth-danger/10 p-6">
            <p className="text-myth-danger">{error}</p>
          </Card>
        </main>
      </TavernPage>
    )
  }

  return (
    <TavernPage>
      <TavernHeader backHref={`/campaigns/${campaignId}`} title="Story Log" campaignId={campaignId} />

      <main className={`max-w-4xl mx-auto px-4 ${HEADER_OFFSET} pb-28`}>
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <p className="text-myth-ink-faint text-sm">
            {campaign?.title || 'Campaign'} — a chronicle of your adventure, updated after each scene
          </p>
          {isAdmin && logs.length > 0 && (
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="secondary" size="sm" className="disabled:opacity-50"
                onClick={handleRegenerate}
                disabled={regenerating}
                title="Re-summarize existing entries with a fresh AI pass"
              >
                {regenerating ? 'Regenerating…' : 'Regenerate All'}
              </Button>
              {regenerateResult && (
                <p className="text-xs text-myth-ink-faint text-right max-w-xs">{regenerateResult}</p>
              )}
            </div>
          )}
        </div>

        {/* Stats */}
        <Card className="p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className={`font-display text-3xl text-myth-ink-muted mb-1`}>{logs.length}</div>
              <div className="text-sm text-myth-ink-faint">Chronicle Entries</div>
            </div>
            <div className="text-center">
              <div className={`font-display text-3xl text-myth-good mb-1`}>
                {logs.reduce((sum, l) => sum + (l.highlights?.length || 0), 0)}
              </div>
              <div className="text-sm text-myth-ink-faint">Key Moments</div>
            </div>
            <div className="text-center">
              <div className={`font-display text-3xl text-myth-ink-muted mb-1`}>{logs[0]?.turnNumber || 0}</div>
              <div className="text-sm text-myth-ink-faint">Current Turn</div>
            </div>
          </div>
        </Card>

        {/* Log Entries */}
        {logs.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="h-12 w-12" />}
            title="No story entries yet"
            description="The story log will be automatically updated as scenes are resolved"
          />
        ) : (
          <div className="space-y-6">
            <CalendarMonthGrid
              campaignId={campaignId}
              onSelectDay={handleSelectDay}
              selectedDayNumber={selectedDayNumber}
            />

            {selectedDayNumber !== null && (
              <Card className="p-5">
                <h3 className={`font-display text-lg text-myth-ink mb-4`}>{selectedDayLabel}</h3>
                {dayDetailLoading ? (
                  <SpinnerBlock className="h-8 w-8" />
                ) : !dayDetail || (dayDetail.logs.length === 0 && dayDetail.rumors.length === 0) ? (
                  <p className="text-sm text-myth-ink-faint">Nothing recorded for this day yet.</p>
                ) : (
                  <div className="space-y-4">
                    {dayDetail.logs.map((log) => (
                      <LogEntryCard key={log.id} log={log} campaignId={campaignId} chronicleShare={chronicleShare} />
                    ))}
                    {dayDetail.rumors.length > 0 && (
                      <div className={dayDetail.logs.length > 0 ? 'pt-4 border-t border-myth-border' : ''}>
                        <h4 className="text-xs font-medium text-myth-ink-faint mb-2 flex items-center gap-1.5">
                          <MessageCircle className="w-3.5 h-3.5" />
                          Word on the Street
                        </h4>
                        <div className="space-y-2">
                          {dayDetail.rumors.map((rumor) => (
                            <Card key={rumor.id} className="p-3">
                              <p className="text-sm font-medium text-myth-ink mb-1">{rumor.title}</p>
                              <p className="text-xs text-myth-ink-muted">{rumor.summary}</p>
                            </Card>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )}

            {preCalendarLogs.length > 0 && (
              <div>
                <Button
                  variant="ghost" size="sm" className="-ml-3 mb-3"
                  onClick={() => setShowPreCalendar((v) => !v)}
                >
                  {(() => { const I = showPreCalendar ? UI_ICONS.expanded : UI_ICONS.collapsed; return <I className="mr-1 inline h-3.5 w-3.5 align-[-0.15em]" /> })()}
                  Before your calendar began ({preCalendarLogs.length})
                </Button>
                {showPreCalendar && (
                  <div className="space-y-4">
                    {preCalendarLogs.map((log) => (
                      <LogEntryCard key={log.id} log={log} campaignId={campaignId} chronicleShare={chronicleShare} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <TavernNav campaignId={campaignId} />
    </TavernPage>
  )
}

// Extracted from the original flat-list rendering so the exact same card
// (Turn badge, entryType tag, inGameDate/duration line, summary,
// highlights, "View in Story" link) renders identically whether it's
// reached via the calendar's day-detail panel or the pre-calendar bucket.
function LogEntryCard({
  log,
  campaignId,
  chronicleShare,
}: {
  log: CampaignLogEntry
  campaignId: string
  chronicleShare: { enabled: boolean; token: string | null } | null
}) {
  const [copied, setCopied] = useState(false)

  // Builds on the existing chronicle share link rather than a separate
  // share mechanism — a recap can only be copied once the campaign has
  // opted into public sharing; clicking Share before that's on takes the
  // admin straight to where it's enabled instead of failing silently.
  const handleShare = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault()
    e.stopPropagation()
    if (!chronicleShare?.enabled || !chronicleShare.token) {
      window.location.href = `/campaigns/${campaignId}/admin?tab=safety`
      return
    }
    navigator.clipboard.writeText(`${window.location.origin}/chronicle/${chronicleShare.token}/recap/${log.id}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Link href={`/campaigns/${campaignId}/story`} className="block">
      <Card className="p-5 group hover:border-myth-border-strong transition-colors cursor-pointer">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-medium text-myth-ink-muted bg-myth-surface-sunken border border-myth-border rounded px-2 py-1">
              Turn {log.turnNumber}
            </span>
            {log.entryType !== 'scene' && (
              <span className="text-xs px-2 py-1 rounded bg-myth-surface-sunken border border-myth-border text-myth-ink-faint">
                {log.entryType}
              </span>
            )}
            <h3 className={`font-display text-lg text-myth-ink`}>{log.title}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <IconButton
              icon={copied ? Check : Share2}
              size="sm"
              label={
                chronicleShare?.enabled
                  ? 'Copy a shareable recap link'
                  : 'Enable the public chronicle link to share a recap'
              }
              className={copied ? 'text-myth-good hover:text-myth-good' : undefined}
              onClick={handleShare}
            />
            <div className="text-xs text-myth-ink-faint whitespace-nowrap">
              {new Date(log.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </div>
          </div>
        </div>

        {log.inGameDate && (
          <p className="text-xs text-myth-ink-faint mb-3">
            {log.inGameDate}
            {log.duration && ` • Duration: ${log.duration}`}
          </p>
        )}

        <p className="text-myth-ink leading-relaxed mb-4 whitespace-pre-wrap text-sm">{log.summary}</p>

        {log.highlights && log.highlights.length > 0 && (
          <div className="pt-4 border-t border-myth-border">
            <h4 className="text-xs font-medium text-myth-ink-faint mb-2">Key Moments</h4>
            <ul className="space-y-1">
              {log.highlights.map((highlight, i) => (
                <li key={i} className="text-sm text-myth-ink-faint flex items-start gap-2">
                  <span className="text-myth-ink-faint mt-1">•</span>
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex items-center gap-1 text-sm text-myth-ink-muted opacity-0 group-hover:opacity-100 transition-opacity">
          <span>View in Story</span>
          <ChevronRight className="w-4 h-4" />
        </div>
      </Card>
    </Link>
  )
}
