// src/lib/notifications/noteShared.ts
// NOTE_SHARED notification writer, used by both notes/route.ts (POST) and
// notes/[noteId]/route.ts (PUT) — Next.js route files can only export HTTP
// method handlers, so this can't live in either route module directly.

import { prisma } from '@/lib/prisma'
import { NotificationService } from './notification-service'

// Best-effort — never blocks the note from being created/updated.
export async function notifyNoteShared(
  campaignId: string,
  authorId: string,
  authorLabel: string,
  noteTitle: string
) {
  try {
    const others = await prisma.campaignMembership.findMany({
      where: { campaignId, userId: { not: authorId } },
      select: { userId: true },
    })
    await Promise.all(
      others.map(m =>
        NotificationService.createNotification({
          type: 'NOTE_SHARED',
          title: 'Note Shared',
          message: `${authorLabel} shared a note: "${noteTitle}"`,
          userId: m.userId,
          campaignId,
        })
      )
    )
  } catch (err) {
    console.error('Failed to send note-shared notifications (non-critical):', err)
  }
}
