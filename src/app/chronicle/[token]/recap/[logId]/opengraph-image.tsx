// src/app/chronicle/[token]/recap/[logId]/opengraph-image.tsx
// The actual shareable card — Next's file-convention OG image for this
// route segment, auto-wired into page.tsx's <head> meta tags (no manual
// <meta property="og:image"> needed). This is what a link preview shows
// when the recap page's URL is pasted into Discord/Twitter/iMessage/etc.
//
// Server-rendered (Node runtime — Prisma needs it), reads directly from
// the DB rather than going through the public API route: this file has no
// use for the extra HTTP hop, and it runs in the same trusted server
// context the route handler does.

import { ImageResponse } from 'next/og'
import { prisma } from '@/lib/prisma'
import { truncateWithEllipsis } from '@/lib/format'

export const alt = 'Session recap'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Long titles/summaries would otherwise overflow the fixed-size card —
// truncate rather than shrink font size indefinitely. Cuts one char short
// of `max` since '…' is a single character, keeping total output length
// capped at `max`.
function truncate(text: string, max: number): string {
  return truncateWithEllipsis(text, max, max - 1)
}

export default async function RecapOpengraphImage({
  params,
}: {
  params: { token: string; logId: string }
}) {
  const campaign = await prisma.campaign.findUnique({
    where: { chronicleShareToken: params.token },
    select: { id: true, title: true, heroImageUrl: true, chronicleShareEnabled: true },
  })

  const log = campaign?.chronicleShareEnabled
    ? await prisma.campaignLog.findUnique({
        where: { id: params.logId },
        select: { campaignId: true, title: true, summary: true },
      })
    : null

  // Not-found/disabled state still renders a card (a broken image is a
  // worse unfurl than a plain one) rather than throwing.
  if (!campaign || !campaign.chronicleShareEnabled || !log || log.campaignId !== campaign.id) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#1a1512',
            color: '#e8ddd0',
            fontSize: 40,
          }}
        >
          Recap unavailable
        </div>
      ),
      { ...size }
    )
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          backgroundColor: '#1a1512',
          backgroundImage: campaign.heroImageUrl
            ? `linear-gradient(to top, rgba(15,12,10,0.95) 20%, rgba(15,12,10,0.55) 65%, rgba(15,12,10,0.25) 100%), url(${campaign.heroImageUrl})`
            : 'linear-gradient(160deg, #2a201a 0%, #1a1512 100%)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          padding: '64px 72px',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 26,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: '#c9a869',
            marginBottom: 16,
          }}
        >
          {truncate(campaign.title, 60)}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 56,
            fontWeight: 600,
            color: '#f5ede0',
            lineHeight: 1.15,
            marginBottom: 24,
          }}
        >
          {truncate(log.title, 90)}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 28,
            color: '#cbbfae',
            lineHeight: 1.4,
          }}
        >
          {truncate(log.summary, 200)}
        </div>
      </div>
    ),
    { ...size }
  )
}
