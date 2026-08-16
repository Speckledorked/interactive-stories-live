// src/lib/theme.ts
//
// Light/dark/system theme preference.
//
// The CSS side of this already existed and was unused: globals.css has
// defined `[data-theme='light']` and `[data-theme='dark']` blocks since
// the myth token pass, and they already override the
// `prefers-color-scheme` media query. Nothing ever set the attribute, so
// the app followed the OS and a light-mode user could never see the dark
// design the mockups were built around. This is the missing half.
//
// Storage is deliberately two-tier:
//   - localStorage is the source of truth for *applying* the theme,
//     because it can be read synchronously before first paint (see
//     THEME_INIT_SCRIPT). A server round-trip cannot.
//   - The User row is the source of truth for *carrying* the preference
//     to another device, and is reconciled into localStorage on load.
// When they disagree, localStorage wins for the current page — the user's
// most recent action on this device is the better guess.

export const THEMES = ['light', 'dark', 'system'] as const
export type Theme = (typeof THEMES)[number]

export const DEFAULT_THEME: Theme = 'system'
export const THEME_STORAGE_KEY = 'mythos-theme'

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

/** Read the stored preference. Returns the default when absent or junk. */
export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(raw) ? raw : DEFAULT_THEME
  } catch {
    // Private browsing / storage disabled — fall back rather than throw.
    return DEFAULT_THEME
  }
}

/**
 * Apply a theme by setting (or clearing) `data-theme` on <html>.
 *
 * 'system' clears the attribute rather than resolving the OS preference
 * to a literal value — that hands control back to the media query, so the
 * page keeps tracking the OS if the user changes it while the tab is open.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

/** Persist and apply in one call. Storage failures don't block applying. */
export function setTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Ignore — the theme still applies for this page.
  }
  applyTheme(theme)
}

/**
 * Runs in <head> before first paint, so a dark-mode user never sees a
 * flash of the light parchment palette (or vice versa) while React
 * hydrates. Inlined as a string because it must execute synchronously and
 * before any component code — a useEffect is far too late.
 *
 * Kept deliberately tiny and try/caught: this is the first script on the
 * page, and an exception here would be an exception before anything else
 * runs. Duplicates a little logic from the functions above on purpose —
 * importing them would defeat the point.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})()`
