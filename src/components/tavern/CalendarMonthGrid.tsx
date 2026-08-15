// src/components/tavern/CalendarMonthGrid.tsx
// The Story Log's month-grid calendar: weeks as rows, days as clickable
// cells, using the campaign's own generated in-fiction calendar (see
// lib/game/calendar.ts) rather than a real-world one. Self-contained — it
// fetches its own month data from /api/campaigns/[id]/logs/calendar rather
// than needing the parent page to already hold the campaign's
// calendarConfig.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { authenticatedFetch } from '@/lib/clientAuth'
import { displayFont } from '@/lib/tavernTheme'
import { TavernCard, TavernSpinner } from './ui'

interface CalendarMonthData {
  year: number
  month: number
  monthName: string
  daysInMonth: number
  weekdayNames: string[]
  firstWeekdayIndex: number
  monthsInYear: number
  startDayNumber: number
  isCurrentMonth: boolean
  currentDayOfMonth: number | null
  markers: Record<string, { hasLogs: boolean; hasRumors: boolean }>
}

interface CalendarMonthGridProps {
  campaignId: string
  onSelectDay: (dayNumber: number, label: string) => void
  selectedDayNumber: number | null
}

export function CalendarMonthGrid({ campaignId, onSelectDay, selectedDayNumber }: CalendarMonthGridProps) {
  const [data, setData] = useState<CalendarMonthData | null>(null)
  const [loading, setLoading] = useState(true)

  const loadMonth = useCallback(async (year?: number, month?: number) => {
    setLoading(true)
    try {
      const qs = year !== undefined && month !== undefined ? `?year=${year}&month=${month}` : ''
      const res = await authenticatedFetch(`/api/campaigns/${campaignId}/logs/calendar${qs}`)
      if (res.ok) {
        setData(await res.json())
      }
    } finally {
      setLoading(false)
    }
  }, [campaignId])

  useEffect(() => {
    loadMonth()
  }, [loadMonth])

  if (loading && !data) {
    return (
      <TavernCard className="p-5">
        <TavernSpinner className="h-10 w-10" />
      </TavernCard>
    )
  }
  if (!data) return null

  const goPrev = () => {
    const prevMonth = data.month - 1 < 0 ? data.monthsInYear - 1 : data.month - 1
    const prevYear = data.month - 1 < 0 ? data.year - 1 : data.year
    loadMonth(prevYear, prevMonth)
  }
  const goNext = () => {
    const nextMonth = (data.month + 1) % data.monthsInYear
    const nextYear = data.month + 1 >= data.monthsInYear ? data.year + 1 : data.year
    loadMonth(nextYear, nextMonth)
  }

  const cells: Array<{ dayOfMonth: number; absoluteDay: number } | null> = []
  for (let i = 0; i < data.firstWeekdayIndex; i++) cells.push(null)
  for (let d = 1; d <= data.daysInMonth; d++) {
    cells.push({ dayOfMonth: d, absoluteDay: data.startDayNumber + d - 1 })
  }

  return (
    <TavernCard className="p-5">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={goPrev}
          aria-label="Previous month"
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-myth-border text-myth-ink-muted hover:border-myth-border-strong transition-colors"
        >
          ‹
        </button>
        <h3 className={`${displayFont.className} text-lg text-myth-ink`}>
          {data.monthName}, Year {data.year}
        </h3>
        <button
          onClick={goNext}
          aria-label="Next month"
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-myth-border text-myth-ink-muted hover:border-myth-border-strong transition-colors"
        >
          ›
        </button>
      </div>

      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${data.weekdayNames.length}, minmax(0, 1fr))` }}
      >
        {data.weekdayNames.map((weekday) => (
          <div key={weekday} className="text-center text-[10px] uppercase tracking-wide text-myth-gold pb-1">
            {weekday.slice(0, 2)}
          </div>
        ))}

        {cells.map((cell, i) => {
          if (!cell) return <div key={`pad-${i}`} />

          const marker = data.markers[String(cell.dayOfMonth)]
          const hasEntries = Boolean(marker?.hasLogs || marker?.hasRumors)
          const isToday = data.isCurrentMonth && data.currentDayOfMonth === cell.dayOfMonth
          const isSelected = selectedDayNumber === cell.absoluteDay

          return (
            <button
              key={cell.dayOfMonth}
              onClick={() => onSelectDay(cell.absoluteDay, `${cell.dayOfMonth} ${data.monthName}, Year ${data.year}`)}
              className={`aspect-square rounded-lg text-sm flex flex-col items-center justify-center gap-0.5 border transition-colors ${
                isSelected
                  ? 'bg-myth-surface-sunken border-myth-accent text-myth-ink'
                  : isToday
                    ? 'border-myth-border-strong bg-myth-surface-sunken text-myth-ink'
                    : 'border-myth-border bg-myth-surface-sunken text-myth-ink-muted hover:border-myth-border-strong'
              }`}
            >
              <span>{cell.dayOfMonth}</span>
              {hasEntries && (
                <span className="flex gap-0.5">
                  {marker?.hasLogs && <span className="w-1 h-1 rounded-full bg-myth-gold" />}
                  {marker?.hasRumors && <span className="w-1 h-1 rounded-full bg-myth-danger" />}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </TavernCard>
  )
}
