'use client'

// src/components/admin/WhatIfControls.tsx
//
// #427: the editable half of the admin reasoning previews.
//
// Every world-entity tab already shows why the tick will do what it will do,
// computed by the same pure `explain*` functions the real tick calls. What
// an admin could not do was change an input and watch the answer move —
// which is the difference between a log and a model, and the reason the
// Admin tooling Scorecard row sat at a 4.
//
// These controls are deliberately plain number inputs rather than sliders.
// A slider invites dragging, dragging invites a request per frame, and each
// request re-runs a real projection server-side. The question being asked
// here is "what if it were 80", not "show me the curve" — so it is typed,
// then applied.

import { useState } from 'react'

export interface WhatIfField {
  key: string
  label: string
  min: number
  max: number
}

interface WhatIfControlsProps {
  fields: WhatIfField[]
  /** Real current values, shown as the placeholder and restored on reset. */
  actual: Record<string, number>
  /** Field keys the server reported it actually applied. */
  overridden?: string[]
  /** Server-side rejections, surfaced verbatim rather than re-derived. */
  rejected?: string[]
  onApply: (overrides: Record<string, number>) => void
  onReset: () => void
  busy?: boolean
}

export function WhatIfControls({
  fields,
  actual,
  overridden = [],
  rejected = [],
  onApply,
  onReset,
  busy = false,
}: WhatIfControlsProps) {
  const [draft, setDraft] = useState<Record<string, string>>({})

  const apply = () => {
    const overrides: Record<string, number> = {}
    for (const field of fields) {
      const raw = draft[field.key]
      if (raw === undefined || raw.trim() === '') continue
      const value = Number(raw)
      // Malformed input is passed through rather than filtered here: the
      // server owns validation, and duplicating its bounds in the client
      // is how the two drift apart. It rejects and says why; this renders
      // what it said.
      if (Number.isFinite(value)) overrides[field.key] = value
    }
    onApply(overrides)
  }

  const reset = () => {
    setDraft({})
    onReset()
  }

  const isHypothetical = overridden.length > 0

  return (
    <div className="mt-3 rounded-lg border border-myth-border bg-myth-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-myth-ink-faint">What if…</p>
        {isHypothetical && (
          // The single most important element here. A projection from
          // invented numbers that LOOKS like a projection from real state
          // is worse than no preview at all — an admin could act on it.
          <span className="rounded-full border border-myth-accent px-2 py-0.5 text-[11px] text-myth-accent">
            Hypothetical — not this campaign&rsquo;s state
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-3">
        {fields.map((field) => (
          <label key={field.key} className="flex flex-col gap-1 text-xs text-myth-ink-muted">
            <span>
              {field.label}
              <span className="ml-1 text-myth-ink-faint">
                (now {actual[field.key] ?? '—'})
              </span>
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={field.min}
              max={field.max}
              aria-label={`${field.label} what-if value`}
              placeholder={String(actual[field.key] ?? '')}
              value={draft[field.key] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
              className="w-24 rounded-md border border-myth-border bg-myth-surface-sunken px-2 py-1 text-sm text-myth-ink"
            />
          </label>
        ))}
      </div>

      {rejected.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {rejected.map((reason) => (
            <li key={reason} className="text-xs text-myth-danger">
              {reason}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={busy}
          className="min-h-[44px] rounded-md border border-myth-border px-3 text-sm text-myth-ink transition-colors hover:border-myth-border-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Projecting…' : 'Project'}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={busy || (!isHypothetical && Object.keys(draft).length === 0)}
          className="min-h-[44px] rounded-md px-3 text-sm text-myth-ink-faint transition-colors hover:text-myth-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          Back to real state
        </button>
      </div>
    </div>
  )
}
