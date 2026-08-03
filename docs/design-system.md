# MythOS "myth" design system

The `myth` visual system (parchment/leather aesthetic, replacing the older
dark `tavern`/`ember`/`wine` palette) lives in `src/app/globals.css`
(`--myth-*` CSS custom properties, light + dark via
`prefers-color-scheme`, or an explicit `[data-theme]` override for a future
manual toggle) and is mapped into Tailwind via `tailwind.config.js`
(`theme.extend.colors`). This file records the two conventions that keep
new pages consistent without re-deriving them each time.

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

## Component opt-in

Shared chrome (`TavernPage`, `TavernBackground`, `TavernHeader`,
`TavernNav`, `TavernMobileMenu`, `SubNavTabs`, `TavernCard`,
`TavernButton`) takes a `variant?: 'tavern' | 'myth'` prop (`background?:`
for `TavernPage`), defaulting to `'tavern'` for backward compatibility.
Pass `"myth"` explicitly on any new or migrated page — there is no global
layout wrapper deciding this automatically (see the per-campaign route
tree, which has no `layout.tsx`).
