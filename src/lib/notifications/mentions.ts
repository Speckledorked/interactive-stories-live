// src/lib/notifications/mentions.ts
// @mention detection for chat messages. Message.hasMentions/mentionsUserIds
// existed in the schema but nothing ever populated them — every message
// was created with the column defaults (false / []), so no MENTION
// notification could ever fire. Deliberately simple: match "@" followed by
// a member's display name (or email local-part if they have none),
// case-insensitive. Not anchored to word boundaries beyond the "@" itself,
// since display names can contain spaces or punctuation a strict \b regex
// would break on.

export interface MentionCandidate {
  userId: string
  name: string | null
  email: string
}

export function detectMentions(
  content: string,
  members: MentionCandidate[],
  authorId: string
): string[] {
  const lower = content.toLowerCase()
  const matched = new Set<string>()

  for (const member of members) {
    if (member.userId === authorId) continue
    const handle = (member.name || member.email.split('@')[0]).trim().toLowerCase()
    if (!handle) continue
    if (lower.includes(`@${handle}`)) {
      matched.add(member.userId)
    }
  }

  return Array.from(matched)
}
