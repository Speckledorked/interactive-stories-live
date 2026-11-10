// src/lib/analytics/creationPath.ts
//
// Which route a character was made through (#508).
//
// #508's one-step path exists to fix a measured drop-off: three of the six
// campaigns strangers started never got a character, and the six-tab wizard
// was the likeliest reason. Shipping the short path without recording which
// one people took would leave that unanswerable — CHARACTER_CREATED fires
// identically either way, so the funnel would show the same number of
// characters and say nothing about whether the change caused them.
//
// Client-reported, and that is fine here in a way it would not be for
// anything else the request carries. This value grants nothing, gates
// nothing and is never read back as authority — it is a label on an
// analytics row. A caller that lies about it skews a dashboard the liar
// cannot see. Contrast archetypeId in the same request, which the server
// validates against campaign-owned rows precisely because it DOES grant
// something.
//
// Normalised rather than trusted verbatim, so the dashboard groups on a
// closed set instead of on whatever arbitrary string arrived.

export type CreationPath = 'quick' | 'full' | 'unspecified'

/**
 * Read a creation path off a request body.
 *
 * Anything unrecognised — absent, misspelled, a number, an object — reads
 * as 'unspecified' rather than throwing or defaulting to one of the real
 * paths. A character made before this shipped, or by a client that does not
 * send it, is genuinely unknown, and recording it as 'full' would invent
 * data that looks like a measurement.
 */
export function normalizeCreationPath(value: unknown): CreationPath {
  return value === 'quick' || value === 'full' ? value : 'unspecified'
}
