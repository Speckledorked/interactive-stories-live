// src/lib/notifications/__tests__/push-service.test.ts
//
// Real Web Push delivery (#92). The behavior worth pinning down here isn't
// "does web-push work" — it's the parts a hand-rolled push implementation
// tends to get wrong: pruning genuinely dead subscriptions while NOT
// pruning on transient errors, and degrading cleanly on a deployment with
// no VAPID keys.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sendNotification = vi.fn()
const setVapidDetails = vi.fn()

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pushSubscription: {
      findMany: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => ({})),
    },
  },
}))

import { prisma } from '@/lib/prisma'

const sub = (endpoint: string) => ({ id: endpoint, userId: 'u1', endpoint, p256dh: 'k', auth: 'a' })

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  process.env.VAPID_PUBLIC_KEY = 'test-public'
  process.env.VAPID_PRIVATE_KEY = 'test-private'
  process.env.VAPID_SUBJECT = 'mailto:test@example.com'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('sendPushToUser', () => {
  it('sends to every registered subscription', async () => {
    ;(prisma.pushSubscription.findMany as any).mockResolvedValue([sub('a'), sub('b')])
    sendNotification.mockResolvedValue({})

    const { sendPushToUser } = await import('../push-service')
    const delivered = await sendPushToUser('u1', { title: 'T', message: 'M' })

    expect(delivered).toBe(2)
    expect(sendNotification).toHaveBeenCalledTimes(2)
  })

  it('sends a payload carrying the title, body and target url', async () => {
    ;(prisma.pushSubscription.findMany as any).mockResolvedValue([sub('a')])
    sendNotification.mockResolvedValue({})

    const { sendPushToUser } = await import('../push-service')
    await sendPushToUser('u1', { title: 'Your turn', message: 'In The Deep Wood', actionUrl: '/campaigns/1' })

    const payload = JSON.parse(sendNotification.mock.calls[0][1] as string)
    expect(payload).toMatchObject({ title: 'Your turn', body: 'In The Deep Wood', url: '/campaigns/1' })
  })

  it('prunes subscriptions the push service reports as gone', async () => {
    ;(prisma.pushSubscription.findMany as any).mockResolvedValue([sub('dead'), sub('alive')])
    sendNotification
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
      .mockResolvedValueOnce({})

    const { sendPushToUser } = await import('../push-service')
    const delivered = await sendPushToUser('u1', { title: 'T', message: 'M' })

    expect(delivered).toBe(1)
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: { in: ['dead'] } },
    })
  })

  it('does NOT prune on a transient failure', async () => {
    // A 5xx or timeout must never unsubscribe anyone — otherwise a
    // momentary push-service outage silently wipes the whole userbase.
    ;(prisma.pushSubscription.findMany as any).mockResolvedValue([sub('a')])
    sendNotification.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }))

    const { sendPushToUser } = await import('../push-service')
    const delivered = await sendPushToUser('u1', { title: 'T', message: 'M' })

    expect(delivered).toBe(0)
    expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled()
  })

  it('never throws when every send fails', async () => {
    ;(prisma.pushSubscription.findMany as any).mockResolvedValue([sub('a')])
    sendNotification.mockRejectedValue(new Error('network down'))

    const { sendPushToUser } = await import('../push-service')
    await expect(sendPushToUser('u1', { title: 'T', message: 'M' })).resolves.toBe(0)
  })

  it('is a no-op for a user with no subscriptions', async () => {
    ;(prisma.pushSubscription.findMany as any).mockResolvedValue([])

    const { sendPushToUser } = await import('../push-service')
    expect(await sendPushToUser('u1', { title: 'T', message: 'M' })).toBe(0)
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('degrades to a no-op when the deployment has no VAPID keys', async () => {
    // A deployment without push keys is supported, not broken.
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY

    const { sendPushToUser } = await import('../push-service')
    expect(await sendPushToUser('u1', { title: 'T', message: 'M' })).toBe(0)
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled()
  })

  it('#314: latches to a single warning instead of throwing on every call when VAPID keys are malformed', async () => {
    setVapidDetails.mockImplementation(() => {
      throw new Error('Invalid GCM/FCM API key')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { sendPushToUser } = await import('../push-service')
    await expect(sendPushToUser('u1', { title: 'T', message: 'M' })).resolves.toBe(0)
    await expect(sendPushToUser('u1', { title: 'T', message: 'M' })).resolves.toBe(0)

    expect(setVapidDetails).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled()

    warnSpy.mockRestore()
    setVapidDetails.mockReset()
  })

  it('#323: only stamps lastUsedAt on subscriptions that actually delivered', async () => {
    ;(prisma.pushSubscription.findMany as any).mockResolvedValue([sub('ok'), sub('transient-fail')])
    sendNotification
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }))

    const { sendPushToUser } = await import('../push-service')
    const delivered = await sendPushToUser('u1', { title: 'T', message: 'M' })

    expect(delivered).toBe(1)
    expect(prisma.pushSubscription.updateMany).toHaveBeenCalledWith({
      where: { endpoint: { in: ['ok'] } },
      data: { lastUsedAt: expect.any(Date) },
    })
  })
})

describe('savePushSubscription', () => {
  const VALID = 'https://fcm.googleapis.com/fcm/send/abc123'

  it('upserts on endpoint so re-subscribing never duplicates', async () => {
    const { savePushSubscription } = await import('../push-service')
    await savePushSubscription({ userId: 'u1', endpoint: VALID, p256dh: 'k', auth: 'a' })

    const call = (prisma.pushSubscription.upsert as any).mock.calls[0][0]
    expect(call.where).toEqual({ endpoint: VALID })
  })

  it('re-points an endpoint at whoever owns it now', async () => {
    // Browsers get shared. A stale row would otherwise deliver one user's
    // notifications to someone else's device.
    const { savePushSubscription } = await import('../push-service')
    await savePushSubscription({ userId: 'u2', endpoint: VALID, p256dh: 'k', auth: 'a' })

    const call = (prisma.pushSubscription.upsert as any).mock.calls[0][0]
    expect(call.update.userId).toBe('u2')
  })

  // #418: the SSRF validator is sound — it survived every bypass the audit
  // attempted. What it lacked was COVERAGE: it was called at exactly one
  // route, and this function wrote whatever it was handed. A guard at the
  // request boundary protects the routes that existed when it was written;
  // a guard at the persistence boundary protects the data, which is what
  // the send path actually trusts.
  it('refuses to persist an endpoint that fails validation', async () => {
    const { savePushSubscription } = await import('../push-service')

    await expect(
      savePushSubscription({ userId: 'u1', endpoint: 'http://169.254.169.254/latest/meta-data', p256dh: 'k', auth: 'a' })
    ).rejects.toThrow(/Refusing to store push endpoint/)

    expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled()
  })

  it('refuses a private-range endpoint even over https', async () => {
    const { savePushSubscription } = await import('../push-service')

    await expect(
      savePushSubscription({ userId: 'u1', endpoint: 'https://127.0.0.1/push', p256dh: 'k', auth: 'a' })
    ).rejects.toThrow(/Refusing to store push endpoint/)

    expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled()
  })
})

describe('getVapidPublicKey', () => {
  it('returns the configured key', async () => {
    const { getVapidPublicKey } = await import('../push-service')
    expect(getVapidPublicKey()).toBe('test-public')
  })

  it('returns null when unconfigured, so the UI can hide the toggle', async () => {
    delete process.env.VAPID_PUBLIC_KEY
    const { getVapidPublicKey } = await import('../push-service')
    expect(getVapidPublicKey()).toBeNull()
  })
})
