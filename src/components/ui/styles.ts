// src/components/ui/styles.ts
//
// The shared constants every UI primitive composes from. This file exists
// because an audit found the alternative doesn't work: before it, 381 raw
// form controls (222 <button>, 94 <input>, 39 <textarea>, 26 <select>)
// across 61 files were each styled with a bespoke className string, and
// the result was 5 different button radii, 4 different paddings, and
// **zero focus rings on all 86 buttons that carried a className**. A
// convention stated in prose and re-typed per call site is not a
// convention; a constant imported by the primitive is.
//
// Rules encoded here rather than left to call sites:
//
// - FOCUS_RING is applied by every interactive primitive, unconditionally
//   and not overridable via className merge order (it comes last).
// - TOUCH_TARGET enforces a 44x44px minimum hit area at EVERY size,
//   including `sm`. This app is mobile-first (docs/design-system.md), so
//   a visually small control expands its tap target rather than shrinking
//   it — hence min-h/min-w rather than fixed h/w.
// - Inputs use a 16px (text-base) minimum font size on mobile. Anything
//   smaller makes iOS Safari zoom the viewport on focus, which is why
//   `text-sm` inputs feel broken on a phone even though they look fine in
//   a desktop browser's responsive mode.
//
// See docs/design-system.md for the type scale and the
// narrative-vs-reference card convention these sit alongside.

/**
 * Visible keyboard focus indicator. Offset against the canvas rather than
 * the immediate parent so the ring stays legible on a sunken surface.
 */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-myth-accent focus-visible:ring-offset-2 focus-visible:ring-offset-myth-canvas'

/**
 * Minimum comfortable hit area, plus the two touch behaviours that were
 * previously sprinkled across individual call sites: `touch-manipulation`
 * removes the ~300ms double-tap-to-zoom delay, and the tap-highlight
 * suppression is applied globally in globals.css (see `.touch-target`).
 */
export const TOUCH_TARGET = 'min-h-[44px] min-w-[44px] touch-manipulation'

/**
 * Same intent as TOUCH_TARGET for controls that are full-width or
 * intrinsically wide (inputs, textareas, list rows) — height only, since
 * constraining min-width on those fights the layout.
 */
export const TOUCH_HEIGHT = 'min-h-[44px] touch-manipulation'

/** One radius for interactive controls. Previously five. */
export const CONTROL_RADIUS = 'rounded-lg'

/** Shared disabled treatment. */
export const DISABLED = 'disabled:opacity-50 disabled:pointer-events-none'

/**
 * Field chrome shared by input/textarea/select so the three can't drift.
 * `text-base sm:text-sm` is deliberate and load-bearing: 16px on mobile
 * prevents iOS zoom-on-focus, 14px on desktop matches the type scale.
 */
export const FIELD_BASE = [
  'w-full',
  CONTROL_RADIUS,
  'border border-myth-border bg-myth-surface',
  'px-3.5 py-2.5',
  'text-base sm:text-sm text-myth-ink placeholder:text-myth-ink-faint',
  'transition-colors',
  'hover:border-myth-border-strong',
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-myth-border',
  FOCUS_RING,
].join(' ')

/** Applied to a field in its error state, after FIELD_BASE. */
export const FIELD_ERROR = 'border-myth-danger hover:border-myth-danger focus-visible:ring-myth-danger'

/**
 * Tiny className joiner. Falsy entries drop out, so conditional classes
 * read as `cond && 'class'` at call sites. Deliberately not `clsx` — this
 * is the whole of what the codebase needs and adding a dependency for it
 * would be ceremony.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
