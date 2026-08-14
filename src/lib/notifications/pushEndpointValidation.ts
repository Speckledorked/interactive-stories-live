// src/lib/notifications/pushEndpointValidation.ts
// #303: POST /api/notifications/push used to accept any string as a push
// subscription's `endpoint` — the only check was `typeof endpoint ===
// 'string'`. push-service.ts's sendPushToUser later calls
// `webpush.sendNotification({ endpoint, ... }, body)`, a server-initiated,
// VAPID-signed outbound HTTP request to whatever was stored. Any
// authenticated user (including a freshly self-signed-up one) could
// register `endpoint: "http://169.254.169.254/latest/meta-data/..."` (or
// any internal-network URL) and then trigger a notification to themselves
// — a self-service, repeatable SSRF primitive against internal
// infrastructure and cloud metadata endpoints.
//
// Two layers, not one: an https-only + real-push-service-hostname
// allowlist (closes the whole class — a "public but not a real push
// service" host is rejected even if it isn't a private IP), plus an
// explicit private/loopback/link-local/metadata-range check on the raw
// hostname (a real SSRF guard, reusable anywhere else a server-side fetch
// target comes from user input, not just this one allowlist's blind spot).

/**
 * Hostnames real browser push services actually use. Exact match, except
 * `*.notify.windows.com` (WNS uses many regional subdomains, e.g.
 * `wns2-xx1p.notify.windows.com`), matched by suffix.
 */
const ALLOWED_PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'android.googleapis.com', // legacy GCM, still seen from older subscriptions
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
])
const ALLOWED_PUSH_HOST_SUFFIX = '.notify.windows.com'

function isAllowedPushHost(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  return ALLOWED_PUSH_HOSTS.has(lower) || lower.endsWith(ALLOWED_PUSH_HOST_SUFFIX)
}

/**
 * True for a hostname that is a private/loopback/link-local/metadata IP
 * literal — the same class `fetch`ing arbitrary internal infrastructure or
 * a cloud metadata endpoint (169.254.169.254) depends on. Only handles IP
 * literals, not a domain name that *resolves* to one (DNS rebinding) —
 * that needs an async lookup at send time, a separate, deeper hardening
 * layer than registration-time validation can provide on its own. The
 * allowlist above is what actually closes the practical hole here: a real
 * push-service hostname is never going to resolve anywhere private.
 */
function isPrivateOrLoopbackHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '::1') return true

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    if (a === 127) return true // loopback
    if (a === 10) return true // private
    if (a === 172 && b >= 16 && b <= 31) return true // private
    if (a === 192 && b === 168) return true // private
    if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
    if (a === 0) return true // "this network"
    return false
  }

  // IPv6 private/loopback/link-local ranges (fc00::/7 unique local,
  // fe80::/10 link-local) — only meaningful for an actual IPv6 literal
  // (always contains a colon; URL.hostname strips the brackets but not
  // the colons), never a regular hostname. Without the colon check, a
  // real hostname starting with "fc"/"fd"/"fe" (e.g. fcm.googleapis.com)
  // would false-positive as a private IPv6 literal.
  if (hostname.includes(':')) {
    const lower = hostname.toLowerCase()
    if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true
    }
  }

  return false
}

export interface PushEndpointValidation {
  valid: boolean
  reason?: string
}

/** Validates a push subscription endpoint at registration time — reject
 * outright, don't fail silently later at send time (#303). */
export function validatePushEndpoint(endpoint: string): PushEndpointValidation {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return { valid: false, reason: 'endpoint must be a valid URL' }
  }

  if (url.protocol !== 'https:') {
    return { valid: false, reason: 'endpoint must use https:' }
  }

  if (isPrivateOrLoopbackHost(url.hostname)) {
    return { valid: false, reason: 'endpoint host is not a public address' }
  }

  if (!isAllowedPushHost(url.hostname)) {
    return { valid: false, reason: 'endpoint host is not a recognized push service' }
  }

  return { valid: true }
}
