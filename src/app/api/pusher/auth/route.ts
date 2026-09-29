// src/app/api/pusher/auth/route.ts
//
// The auth endpoint for Pusher private channels (#491).
//
// Before this, no such route existed anywhere in the repository, and both
// channels were public — meaning subscribable by anyone with the app key,
// which ships in the client bundle by necessity. See lib/realtime/channels.ts
// for what that exposed.
//
// pusher-js calls this with `socket_id` and `channel_name` when a
// `private-` subscription is attempted, and refuses the subscription
// without a valid signature in return. The signature is what the prefix
// buys: the check below is the only thing deciding who gets one.
//
// Form-encoded, not JSON: that is pusher-js's wire format, and reading the
// body as JSON here would fail on every real request while passing any
// test that sent JSON.

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { PusherServer } from '@/lib/realtime/pusher-server'
import { campaignIdFromChannel, userIdFromChannel } from '@/lib/realtime/channels'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const user = await getUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await request.formData().catch(() => null)
  const socketId = form?.get('socket_id')
  const channelName = form?.get('channel_name')
  if (typeof socketId !== 'string' || typeof channelName !== 'string') {
    return NextResponse.json({ error: 'socket_id and channel_name are required' }, { status: 400 })
  }

  const pusher = PusherServer()
  if (!pusher) {
    // Unconfigured deployment. 503 rather than a fake grant: a signature
    // cannot be faked, so there is nothing useful to return, and the
    // client's own subscription failure is the honest outcome.
    return NextResponse.json({ error: 'Realtime is not configured' }, { status: 503 })
  }

  const campaignId = campaignIdFromChannel(channelName)
  if (campaignId) {
    const membership = await getCampaignMembership(user.userId, campaignId)
    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }
    return NextResponse.json(pusher.authorizeChannel(socketId, channelName))
  }

  const userId = userIdFromChannel(channelName)
  if (userId) {
    // Exact match only. This channel carries whispers and notification
    // previews in cleartext, and it is the one channel where "knows the id"
    // was most obviously not a permission: user ids are published to every
    // member of a campaign in message payloads.
    if (userId !== user.userId) {
      return NextResponse.json({ error: 'Not your channel' }, { status: 403 })
    }
    return NextResponse.json(pusher.authorizeChannel(socketId, channelName))
  }

  // Default deny. A channel shape this route does not recognise gets no
  // signature — so adding a new private channel means adding its rule here,
  // rather than inheriting a grant by accident.
  return NextResponse.json({ error: 'Unknown channel' }, { status: 403 })
}
