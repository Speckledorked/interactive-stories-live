// src/components/tavern/headerOffset.ts
//
// Top padding that clears the fixed TavernHeader.
//
// The header is `fixed`, so it takes up no flow height and each page has to
// pad its own content out from under it. Every page used to hardcode
// `pt-28` (112px) for this. That was wrong wherever a page passed a
// `subrow`: the bar is 122px tall with one (128 on the story page), so the
// first line of content rendered underneath it — a ~10px clip visible on
// /wiki, /world and /settings at mobile widths.
//
// The number is no longer written down. TavernHeader measures itself and
// publishes `--myth-header-h`; these offsets are that measurement plus a
// consistent 2rem of breathing room. The header can grow a taller subrow,
// a second line, or a new breakpoint and the padding follows it.
//
// The two constants differ ONLY in their pre-hydration fallback, which is
// what renders for the one frame before the ResizeObserver publishes a real
// value. Erring high is the safe direction: a slightly wide gap for one
// frame is invisible, a clipped heading is not.

/** For pages whose header is the bar alone (~72px). */
export const HEADER_OFFSET = 'pt-[calc(var(--myth-header-h,72px)+2rem)]'

/** For pages that pass a `subrow` (~122-128px). */
export const HEADER_OFFSET_SUBROW = 'pt-[calc(var(--myth-header-h,128px)+2rem)]'
