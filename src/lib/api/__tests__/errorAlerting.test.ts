// src/lib/api/__tests__/errorAlerting.test.ts
//
// #492: reportError — the webhook alerter that turns a production failure
// into a phone notification — was called by background jobs and by no API
// route at all. Every unexpected 500 the app served went to console.error
// and stopped there: perfectly recorded in a log drain nobody is reading
// at 2am, which is the only time it matters.
//
// These two helpers are the generic-500 path for roughly thirty routes,
// which is why they are the place to wire it rather than thirty catch
// blocks. The 401 branch is deliberately silent: an unauthenticated request
// is the auth layer working, and paging on it would train whoever reads the
// channel to stop reading it.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/monitoring', () => ({ reportError: vi.fn().mockResolvedValue(undefined) }))

import { reportError } from '@/lib/monitoring'
import { handleRouteError, handleRouteErrorWithDetails } from '../errors'

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe.each([
  ['handleRouteError', handleRouteError],
  ['handleRouteErrorWithDetails', handleRouteErrorWithDetails],
])('%s', (_name, handle) => {
  it('alerts on an unexpected failure', () => {
    const boom = new Error('db down')
    const response = handle(boom, 'create-character', 'Failed to create character')

    expect(response.status).toBe(500)
    expect(reportError).toHaveBeenCalledWith('create-character', boom)
  })

  it('stays silent on an auth refusal', () => {
    const response = handle(new Error('Unauthorized'), 'create-character', 'Failed')

    expect(response.status).toBe(401)
    expect(reportError).not.toHaveBeenCalled()
  })

  it('does not make the error response wait on the webhook', async () => {
    // reportError bounds itself with a 3s abort, but awaiting it would
    // still put a webhook round trip in front of every 500 the app serves.
    let settle: () => void = () => {}
    ;(reportError as any).mockReturnValue(new Promise<void>((r) => { settle = r }))

    const response = handle(new Error('db down'), 'ctx', 'Failed')

    // Returned synchronously, with the alert still in flight.
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: 'Failed' })
    settle()
  })
})
