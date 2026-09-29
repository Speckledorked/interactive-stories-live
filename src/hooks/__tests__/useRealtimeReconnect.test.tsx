// src/hooks/__tests__/useRealtimeReconnect.test.tsx
//
// #502: Pusher events are fire-and-forget. Anything published while a
// client is disconnected is gone, so a dropped connection does not degrade
// a panel — it freezes one, with no error and no spinner, looking exactly
// like a quiet campaign. Nothing prompts the person to reload.
//
// The two cases that matter are symmetrical and easy to get backwards:
// firing on the first connect makes every mount do a redundant refetch,
// and not firing on recovery leaves the bug in place.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const handlers: Array<(s: { previous: string; current: string }) => void> = []
const connection = {
  bind: vi.fn((_event: string, handler: any) => { handlers.push(handler) }),
  unbind: vi.fn((_event: string, handler: any) => {
    const i = handlers.indexOf(handler)
    if (i >= 0) handlers.splice(i, 1)
  }),
}

vi.mock('@/lib/realtime/pusher-client', () => ({
  getPusherClient: vi.fn(() => ({ connection })),
}))

import { getPusherClient } from '@/lib/realtime/pusher-client'
import { useRealtimeReconnect } from '../useRealtimeReconnect'

function emit(current: string) {
  for (const handler of [...handlers]) handler({ previous: 'x', current })
}

beforeEach(() => {
  vi.clearAllMocks()
  handlers.length = 0
  ;(getPusherClient as any).mockReturnValue({ connection })
})

describe('useRealtimeReconnect', () => {
  it('does not fire on the initial connect', () => {
    // The caller has just loaded its own data; refetching immediately
    // would double every mount's requests for nothing.
    const onReconnect = vi.fn()
    renderHook(() => useRealtimeReconnect(onReconnect))

    emit('connecting')
    emit('connected')

    expect(onReconnect).not.toHaveBeenCalled()
  })

  it('fires once when the connection recovers after a real drop', () => {
    const onReconnect = vi.fn()
    renderHook(() => useRealtimeReconnect(onReconnect))

    emit('connected')
    emit('unavailable')
    emit('connecting')
    emit('connected')

    expect(onReconnect).toHaveBeenCalledTimes(1)
  })

  it('fires again on a second drop', () => {
    const onReconnect = vi.fn()
    renderHook(() => useRealtimeReconnect(onReconnect))

    emit('disconnected')
    emit('connected')
    emit('failed')
    emit('connected')

    expect(onReconnect).toHaveBeenCalledTimes(2)
  })

  it('does nothing when realtime is unconfigured', () => {
    ;(getPusherClient as any).mockReturnValue(null)
    const onReconnect = vi.fn()
    expect(() => renderHook(() => useRealtimeReconnect(onReconnect))).not.toThrow()
    expect(onReconnect).not.toHaveBeenCalled()
  })

  it('unbinds on unmount', () => {
    const { unmount } = renderHook(() => useRealtimeReconnect(vi.fn()))
    expect(handlers).toHaveLength(1)
    unmount()
    expect(handlers).toHaveLength(0)
  })

  it('does not re-subscribe when the caller passes a new closure each render', () => {
    // Callers pass inline arrows. Re-binding on every render would tear
    // down and rebuild the listener constantly, and could miss the very
    // transition this exists to catch.
    const { rerender } = renderHook(() => useRealtimeReconnect(() => {}))
    rerender()
    rerender()
    expect(connection.bind).toHaveBeenCalledTimes(1)
  })

  it('calls the LATEST callback, not the one captured at mount', () => {
    const stale = vi.fn()
    const fresh = vi.fn()
    const { rerender } = renderHook(({ cb }) => useRealtimeReconnect(cb), {
      initialProps: { cb: stale },
    })
    rerender({ cb: fresh })

    emit('unavailable')
    emit('connected')

    expect(stale).not.toHaveBeenCalled()
    expect(fresh).toHaveBeenCalledTimes(1)
  })
})
