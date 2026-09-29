// src/lib/realtime/channels.ts
//
// The names of the two Pusher channels this app uses, in one place.
//
// #491: both were PUBLIC channels — `campaign-<id>` and `user-<id>` — with
// no auth endpoint anywhere in the repository. A Pusher public channel is
// subscribable by anyone holding the app key, and the app key is
// NEXT_PUBLIC_ by necessity: it ships in the client bundle. So the only
// thing standing between a stranger and another player's realtime feed was
// knowing an id — and ids are not secrets here. A campaign id travels in
// the URL bar and in every shared invite link; a user id is published in
// message payloads to everyone in a campaign.
//
// What was reachable: whispers (`new-whisper` on the recipient's channel,
// cleartext), notification payloads including their preview text, and every
// campaign broadcast — scene resolutions, chat, notes, clocks — for any
// campaign whose invite link had ever been passed along, including to
// people who never joined and to people who were removed.
//
// `private-` is not decoration: Pusher refuses to subscribe a channel with
// that prefix without a signed grant from an auth endpoint, so the prefix
// and the check in /api/pusher/auth are two halves of one mechanism.
// Renaming a channel without adding the endpoint would break realtime;
// adding the endpoint without renaming would secure nothing.
//
// Constructed here rather than inline, which is the part that matters for
// keeping it fixed. Twenty-five files built these names from their own
// template literals — publishers and subscribers, server and client — so
// "are we private yet" was a question with twenty-five independent answers
// and no way to ask it once. A convention test now forbids the raw form.

/**
 * Everything a campaign broadcasts: scene lifecycle, chat, notes, clocks,
 * typing indicators, map and image readiness.
 *
 * Authorised for members of that campaign (see /api/pusher/auth).
 */
export function campaignChannel(campaignId: string): string {
  return `private-campaign-${campaignId}`
}

/**
 * One person's own feed: whispers and notifications.
 *
 * Authorised for that user and nobody else.
 */
export function userChannel(userId: string): string {
  return `private-user-${userId}`
}

/** `private-campaign-<id>` -> `<id>`, or null if it is not that shape. */
export function campaignIdFromChannel(channel: string): string | null {
  const match = channel.match(/^private-campaign-(.+)$/)
  return match ? match[1] : null
}

/** `private-user-<id>` -> `<id>`, or null if it is not that shape. */
export function userIdFromChannel(channel: string): string | null {
  const match = channel.match(/^private-user-(.+)$/)
  return match ? match[1] : null
}
