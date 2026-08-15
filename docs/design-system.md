# MythOS "myth" design system

The `myth` visual system (parchment/leather aesthetic) lives in
`src/app/globals.css` — `--myth-*` CSS custom properties, light + dark via
`prefers-color-scheme` plus an explicit `[data-theme]` override driven by
the Light/Dark/System control in Settings — and is mapped into Tailwind via
`tailwind.config.js` (`theme.extend.colors`).

It is the only visual system in the app. The older dark
`tavern`/`ember`/`wine` palette is fully retired: every page and component
is on myth tokens, and the tavern half of the system has been deleted (see
"The tavern theme is gone" at the end of this file). An
`ember-*`/`wine-*`/`tavern-*` class in a live `className` is a mistake, not
a surviving variant — the only such strings left in `src/` are two inside
a comment in `ui/spinner.tsx` recording what that file replaced.

This file records the conventions that keep new pages consistent without
re-deriving them each time.

## Accent color

`--myth-accent`/`-accent-hover`/`-accent-ink` is a deep royal purple/
jewel-violet (hue ≈ 275° in both light and dark mode), chosen to sit far
from every semantic hue — `--myth-good` (~140°), `--myth-warn` (~37°),
`--myth-danger` (~0°), `--myth-info` (~208°). The previous accent
(`138 106 31`, hue ≈ 42°) sat almost on top of `--myth-warn`, which is why
an accented button read as a caution state and the palette as a whole felt
flat. Contrast against `--myth-surface`/`--myth-canvas` is ≥9:1 in light
mode and ≥6:1 in dark mode, so `text-myth-accent`/`bg-myth-accent` stay
legible as either text or a button fill in both modes. Hover darkens in
light mode and brightens in dark mode, matching every other token pair's
convention.

## Type scale — use `SectionHeader`, don't hand-roll

`src/components/ui/section-header.tsx` is the single source of the
heading hierarchy. Reach for it instead of writing a one-off
`<h2 className="font-display text-lg font-semibold">`:

| Tier | Use | Size | Component |
|---|---|---|---|
| 1 — Page hero | Once per page: the campaign/character/quest-log's own title | `text-3xl sm:text-4xl` | Standalone hero pattern (see `CampaignHero.tsx`) — not `SectionHeader`, this tier is deliberately a one-off, bigger treatment |
| 2 — Section header | A tab's or page's top-level content section, especially anything with no surrounding card chrome (see "Narrative vs. reference" below) | `text-xl sm:text-2xl` | `<SectionHeader as="h2" .../>` |
| 3 — Card-scoped / per-item title | A heading inside a bordered reference card, or a per-item heading inside a flowing list | `text-lg` | `<SectionHeader as="h3" .../>` |
| Eyebrow | Small label above a title | `text-xs uppercase tracking-wider`, `font-mono`, never `font-display` | `SectionHeader`'s `eyebrow` prop |

`font-display` (Fraunces) is for tiers 1–3 only — never for eyebrows, body
copy, or plain UI text (buttons, form labels, badges).

## Narrative vs. reference content

Not every block of content should be a bordered card. Two patterns:

- **Reference/utility** — CRUD lists, forms, anything with per-item
  actions, counts, or tabular data. Keep the bordered-card treatment:
  `rounded-lg`/`rounded-md border border-myth-border bg-myth-surface
  p-4`/`p-5`.
- **Narrative** — story logs, recaps, world summaries, prose meant to be
  *read*, not acted on. Follow `WorldChronicle.tsx`
  (`src/components/campaigns/lobby/WorldChronicle.tsx`), the canonical
  example: no outer box, a Tier-2 `SectionHeader` title, flowing content,
  `divide-y divide-myth-border` (or `border-b border-myth-border` per
  entry) between repeated items instead of individually boxing each one,
  generous whitespace instead of padding-in-a-box.

**Test for an ambiguous case:** if you stripped the border, would you lose
the sense that clicking things inside does something? If yes, it's
reference content — keep the border. If the block's only job is to be
read, it's narrative — drop the box.

## Mobile-first

This app is mobile-first, not desktop-first: design and build for the
bottom-tab-bar/drawer mobile chrome (`TavernNav`, `TavernMobileMenu`,
`TavernHeader`'s mobile top bar) as the primary experience, then adapt up
to wider viewports (`TavernSidebar` at `lg:+`) — not the other way around.
When a chrome or content change lands on one nav surface (e.g. the
sidebar's active-state pill), bring the equivalent mobile surface up to
the same level in the same pass rather than treating desktop polish as
sufficient on its own.

## Controls are components, not classes

Every interactive control comes from `src/components/ui/`: `Button`,
`IconButton`, `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `Tabs`,
`Dialog`, `Spinner`. Do not hand-style a raw `<button>` or `<input>`, and
do not add a `.btn-*`-style class to `globals.css` — that file has no
component layer anymore, on purpose. A CSS class cannot enforce a focus
ring, an accessible name, or a 44px touch target, and the absence of the
first and last of those was this app's single most widespread UI defect
(86 of 86 styled buttons had no focus ring before the Phase 0 sweep).

Two rules the primitives enforce so call sites can't get them wrong:

- **44px minimum hit area at every size**, including `size="sm"` — the
  visual control shrinks, the tap target doesn't. `IconButton` exists
  mainly so an icon-only control can't ship without an accessible `label`.
- **`text-base` on inputs below `sm:`** — anything smaller makes iOS
  Safari zoom the viewport on focus.

### What deliberately stays a raw `<button>`

Three categories are *not* buttons in the primitive sense, and forcing
them through `Button` would add padding and a min-height their layouts
don't want:

- **Clickable cards** — campaign template cards, wiki entry rows,
  archetype pickers, command-palette results, calendar day cells. The
  whole surface is the target; it's already far past 44px.
- **Disclosure headers** — a full-width row that expands the section
  below it (the story page's collapsible panels, `AITransparencyPanel`).
- **Nav rows** — `TavernSidebar` / `TavernMobileMenu` / `AdminNav` list
  items, which own their own active-state treatment.

All three still get a visible focus ring, because `globals.css`'s base
layer draws one on `:focus-visible` for every focusable element rather
than relying on each component to remember. That inversion is the point:
forgetting yields a ring, not the absence of one.

## Theme

`src/lib/theme.ts` owns it: `'light' | 'dark' | 'system'`, defaulting to
`system`. `localStorage` (`mythos-theme`) is the source of truth for
*applying* a theme; `User.themePreference` persists it across devices and
is reconciled in on load, with localStorage winning for the current page.

`THEME_INIT_SCRIPT` runs inline in `layout.tsx` **before first paint** so
an explicitly-chosen dark theme doesn't flash light on load — that's why
it's an inline string rather than a normal module.

Write colours as tokens (`bg-myth-surface`, `text-myth-ink`) and both
themes come free. Never hardcode a hex or a Tailwind stock colour
(`bg-slate-800`) in app code — it will be right in one theme and wrong in
the other.

## Clearing the fixed header

`TavernHeader` is `fixed`, so it contributes no flow height and each page
has to pad its own content out from under it. **Do not hardcode that
padding.** Use the shared offsets:

```tsx
import { HEADER_OFFSET, HEADER_OFFSET_SUBROW } from '@/components/tavern/headerOffset'

<main className={`max-w-4xl mx-auto px-4 ${HEADER_OFFSET} pb-28`}>
```

Use `HEADER_OFFSET_SUBROW` on any page that passes a `subrow`, and
`HEADER_OFFSET` otherwise.

Both resolve to `--myth-header-h` (which `TavernHeader` measures itself
into via a `ResizeObserver`) plus 2rem of breathing room; they differ only
in their pre-hydration fallback. Every page used to hardcode `pt-28`
(112px) instead, which was simply wrong wherever a page had a subrow — the
bar is 122px tall with one, 128 on the story page — so the first line of
content rendered *underneath* it. A static number can't be right for a bar
whose height depends on the subrow, and on the breakpoint: the campaign
lobby's header measures 121px at 390px and 68px at 1440px.

## Icons

One vocabulary, from `src/lib/ui/icons.ts` (`ENTITY_ICONS`, `MOOD_ICONS`,
`NOTIFICATION_ICONS`, `UI_ICONS`, …), all `lucide-react`. **No emoji as UI
chrome** — not as disclosure arrows, status glyphs, or button faces. The
app had ~280 of them across 36 files before the Phase 2 sweep; they don't
respond to theme or font size, can't take a colour token, and render
differently per platform.

Emoji stay only where they're *content*: the campaign-template picker's
author-chosen emoji, and anything a player typed.

## Navigation vs. tabsets

Two different things, two different components:

- **`SubNavTabs`** is navigation. Most of its items are `Link`s to sibling
  pages, and a set of links is not a tabset. It marks the current item with
  `aria-current` — not `role="tab"`/`aria-selected`, which would also
  require a `role="tablist"` container and `tabpanel` targets this
  component doesn't own.
- **`ui/tabs.tsx`** is for genuine in-page tabsets that swap panel content,
  and has the full tablist wiring.

## The tavern theme is gone

Deleted, not deprecated — don't go looking for it:

| Was | Status |
|---|---|
| `src/components/tavern/ui.tsx` (`TavernCard`, `TavernButton`, `TavernEmptyState`, `TavernSpinner`, `TavernErrorBanner`) | Deleted. Use `ui/card.tsx`, `ui/button.tsx`, `ui/empty-state.tsx`, `ui/spinner.tsx`. |
| `src/lib/tavernTheme.ts` (`displayFont` Cinzel, `bodyFont` Cormorant Garamond) | Deleted. Use `font-display` (Fraunces) / the sitewide sans. |
| `public/images/tavern-bg.jpg` | Deleted. `TavernBackground` is a myth-canvas fill with a dark-mode vignette. |
| `variant?: 'tavern' \| 'myth'` on `TavernHeader`, `TavernNav`, `TavernMobileMenu`, `TavernBackground`, `SubNavTabs`; `background?:` on `TavernPage` | Removed along with every branch behind them. These components take no theme prop — pass nothing. |

The `Tavern*` names survive on the chrome components purely because
renaming ~14 call sites bought nothing; they are the app's only chrome and
have no relationship to the retired theme.
