// src/lib/notifications/__tests__/pushEndpointValidation.test.ts
// #303: validatePushEndpoint is the SSRF guard for POST
// /api/notifications/push — a stored endpoint is a server-initiated,
// VAPID-signed outbound request target, so every rejection path here maps
// directly to an attack this guard exists to close.

import { describe, it, expect } from 'vitest'
import { validatePushEndpoint } from '../pushEndpointValidation'

describe('validatePushEndpoint', () => {
  it('accepts real push-service endpoints', () => {
    expect(validatePushEndpoint('https://fcm.googleapis.com/fcm/send/abc123').valid).toBe(true)
    expect(validatePushEndpoint('https://android.googleapis.com/gcm/send/abc123').valid).toBe(true)
    expect(validatePushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc').valid).toBe(true)
    expect(validatePushEndpoint('https://web.push.apple.com/QAbc').valid).toBe(true)
  })

  it('accepts any *.notify.windows.com regional subdomain', () => {
    expect(validatePushEndpoint('https://wns2-xx1p.notify.windows.com/w/abc').valid).toBe(true)
    expect(validatePushEndpoint('https://wns2-other-region.notify.windows.com/w/abc').valid).toBe(true)
  })

  it('rejects a cloud metadata endpoint', () => {
    const result = validatePushEndpoint('http://169.254.169.254/latest/meta-data/')
    expect(result.valid).toBe(false)
  })

  it('rejects private-network IP literals (10.x, 172.16-31.x, 192.168.x)', () => {
    expect(validatePushEndpoint('https://10.0.0.5/hook').valid).toBe(false)
    expect(validatePushEndpoint('https://172.16.0.1/hook').valid).toBe(false)
    expect(validatePushEndpoint('https://172.31.255.255/hook').valid).toBe(false)
    expect(validatePushEndpoint('https://192.168.1.1/hook').valid).toBe(false)
  })

  it('rejects loopback (127.x, localhost, ::1)', () => {
    expect(validatePushEndpoint('https://127.0.0.1/hook').valid).toBe(false)
    expect(validatePushEndpoint('https://localhost/hook').valid).toBe(false)
    expect(validatePushEndpoint('https://[::1]/hook').valid).toBe(false)
  })

  it('rejects IPv6 unique-local and link-local ranges', () => {
    expect(validatePushEndpoint('https://[fd00::1]/hook').valid).toBe(false)
    expect(validatePushEndpoint('https://[fe80::1]/hook').valid).toBe(false)
  })

  it('rejects a public but non-allowlisted hostname, even over https', () => {
    const result = validatePushEndpoint('https://evil.example.com/collect')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('not a recognized push service')
  })

  it('rejects a real push-service hostname over plain http', () => {
    const result = validatePushEndpoint('http://fcm.googleapis.com/fcm/send/abc123')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('https')
  })

  it('rejects a malformed URL', () => {
    const result = validatePushEndpoint('not-a-url')
    expect(result.valid).toBe(false)
  })

  it('does not false-positive on a hostname that merely contains a private-looking substring', () => {
    // "10.0.0.5.evil.example.com" is a real public DNS name, not the IP
    // literal 10.0.0.5 — must fail on the allowlist check, not be
    // mistakenly treated as a private-IP match.
    const result = validatePushEndpoint('https://10.0.0.5.evil.example.com/hook')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('not a recognized push service')
  })
})
