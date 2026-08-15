// src/components/settings/ThemeSetting.tsx
//
// Light / Dark / System picker.
//
// Applies immediately on click (localStorage + the data-theme attribute)
// and saves to the User row in the background. The local write is what
// matters for the current device — the server round-trip only exists so
// the choice follows the user elsewhere — so a failed save is surfaced
// quietly rather than reverting a theme the user can plainly see applied.

'use client'

import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { authenticatedFetch } from '@/lib/clientAuth'
import { getStoredTheme, isTheme, setTheme, type Theme } from '@/lib/theme'
import { FOCUS_RING, cn } from '@/components/ui/styles'

const OPTIONS: Array<{ value: Theme; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

export function ThemeSetting() {
  const [theme, setThemeState] = useState<Theme>('system')
  const [saveFailed, setSaveFailed] = useState(false)

  // Read from localStorage after mount, never during render: the server
  // renders without it, so using it as initial state would hydrate
  // mismatched. The pre-paint script in layout.tsx has already applied
  // the correct theme by this point — this only syncs the control's UI.
  useEffect(() => {
    setThemeState(getStoredTheme())
  }, [])

  // Reconcile the server's stored preference. localStorage wins when they
  // disagree (it reflects the most recent action on this device), so this
  // only adopts the server value when nothing is stored locally — i.e. a
  // fresh device picking up a choice made elsewhere.
  useEffect(() => {
    let cancelled = false
    authenticatedFetch('/api/user')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        const remote = data?.user?.themePreference
        if (!isTheme(remote)) return
        try {
          if (window.localStorage.getItem('mythos-theme')) return
        } catch {
          return
        }
        setTheme(remote)
        setThemeState(remote)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const choose = async (next: Theme) => {
    setTheme(next)
    setThemeState(next)
    setSaveFailed(false)
    try {
      const res = await authenticatedFetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themePreference: next }),
      })
      if (!res.ok) setSaveFailed(true)
    } catch {
      setSaveFailed(true)
    }
  }

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-myth-ink-muted">Appearance</p>
      <div
        role="radiogroup"
        aria-label="Appearance"
        className="inline-flex flex-wrap gap-1 rounded-lg border border-myth-border bg-myth-surface-sunken p-1"
      >
        {OPTIONS.map((option) => {
          const active = theme === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choose(option.value)}
              className={cn(
                'inline-flex min-h-[44px] items-center gap-2 rounded-md px-3.5 text-sm font-medium transition-colors touch-manipulation',
                active
                  ? 'bg-myth-accent text-myth-accent-ink'
                  : 'text-myth-ink-muted hover:bg-myth-surface hover:text-myth-ink',
                FOCUS_RING
              )}
            >
              <option.icon className="h-4 w-4" />
              {option.label}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-myth-ink-faint">
        {theme === 'system'
          ? 'Following your device setting.'
          : `Always ${theme}, regardless of your device setting.`}
      </p>
      {saveFailed && (
        <p className="mt-1 text-xs text-myth-warn">
          Applied on this device, but we couldn&apos;t save it to your account — it may not carry to other
          devices.
        </p>
      )}
    </div>
  )
}
