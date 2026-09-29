// src/lib/notifications/__tests__/pushClientNoHang.test.ts
//
// Enabling or disabling push must SETTLE, even when no service worker is
// registered — which, in this build, is always.
//
// public/sw.js exists but nothing has ever called serviceWorker.register
// (verified across the whole git history), so there is no registration to
// find. Both functions used to await `navigator.serviceWorker.ready`, and
// `.ready` is the one promise here that never rejects: with nothing active
// it simply never settles. So the notifications toggle spun forever with no
// error, no feedback and nothing in the console — the failure mode that
// looks like the network being slow and never resolves into a diagnosis.
//
// disablePush had the worse version of it. Its contract, stated in its own
// doc comment, is that the server-side delete runs even when the local
// unsubscribe fails, so a browser that lost its subscription doesn't strand
// a row that keeps receiving sends. An await that never settles never
// reaches that delete, so the hang silently inverted the guarantee.
//
// These tests pin "settles", not "succeeds". Making push actually deliver
// needs a registered worker, and that has to come with fixing sw.js's
// cache-first fetch handler first — registering it as written would pin
// every visitor to the build they first loaded.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchMock = vi.fn()

/** A browser that supports push but has no service worker registered. */
function installNavigator(getRegistration: () => Promise<unknown>) {
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration,
      // Present and shaped right, but never settles — exactly as a real
      // browser behaves with nothing registered. If the code under test
      // awaits this, these tests time out, which is the point.
      ready: new Promise(() => {}),
    },
  })
  vi.stubGlobal('window', { PushManager: class {}, Notification: class {}, atob: (s: string) => s })
  vi.stubGlobal('Notification', { requestPermission: vi.fn().mockResolvedValue('granted') })
  vi.stubGlobal('fetch', fetchMock)
}

beforeEach(() => {
  vi.resetModules()
  fetchMock.mockReset()
  vi.stubGlobal('localStorage', { getItem: () => 'token', setItem: () => {}, removeItem: () => {} })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('enablePush with no service worker registered', () => {
  it('returns a failure instead of hanging', async () => {
    installNavigator(async () => undefined)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ configured: true, publicKey: 'AAAA' }),
    })

    const { enablePush } = await import('../push-client')
    const result = await enablePush()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('failed')
      // The message names the actual cause rather than "something went
      // wrong" — whoever hits this needs to know a worker is missing, not
      // that an unspecified step failed.
      expect(result.detail).toMatch(/service worker/i)
    }
  })
})

describe('disablePush with no service worker registered', () => {
  it('settles rather than hanging', async () => {
    installNavigator(async () => undefined)
    const { disablePush } = await import('../push-client')
    await expect(disablePush()).resolves.toBeUndefined()
  })

  it('still reaches the server delete when a subscription exists', async () => {
    // The guarantee the hang was quietly breaking.
    const unsubscribe = vi.fn().mockRejectedValue(new Error('already gone'))
    installNavigator(async () => ({
      pushManager: {
        getSubscription: async () => ({ endpoint: 'https://push.example/abc', unsubscribe }),
      },
    }))
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })

    const { disablePush } = await import('../push-client')
    await disablePush()

    const deleteCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'DELETE')
    expect(deleteCall, 'the server-side delete must run even when unsubscribe() rejects').toBeTruthy()
    expect(String(deleteCall![1].body)).toContain('https://push.example/abc')
  })
})
