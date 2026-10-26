// src/lib/game/worldChronicle.ts
//
// How much of the world's history one page of the chronicle reads (#522).
//
// These lived in the route itself and broke the production build. A
// Next.js App Router `route.ts` may only export the handful of names the
// framework reserves — the HTTP methods, `dynamic`, `revalidate`,
// `runtime` and friends — and `next build` generates a type validator that
// rejects anything else:
//
//   Route "…/world-chronicle/route.ts" does not match the required types
//   of a Next.js Route. "CHRONICLE_PAGE_SIZE" is not a valid Route export
//   field.
//
// `tsc --noEmit` cannot see that, because the constraint only exists once
// `next build` has written those validators. No other route.ts in this
// repo exports a non-method name, so the convention was already here; a
// guard test now states it (see __tests__/routeExports.test.ts).

/** Entries returned per page. */
export const CHRONICLE_PAGE_SIZE = 30

/**
 * Rows read per page before filtering.
 *
 * Both the fog pass and the phrasing drop rows after the query, so taking
 * exactly the page size would return short pages and, worse, stop early:
 * a page that filtered down to zero would look like the end of history.
 * Scanning wider and reporting the real cursor keeps "is there more"
 * answerable from the rows actually read.
 */
export const CHRONICLE_SCAN = CHRONICLE_PAGE_SIZE * 6
