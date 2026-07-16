// src/lib/auth/platformAdmin.ts
// Gate for the global (not per-campaign) admin analytics dashboard. Same
// solo-operator philosophy as ERROR_WEBHOOK_URL/internal job secrets: an
// env var allowlist rather than a schema-backed role, since there's no UI
// need to grant this to anyone but the operator(s) running the deploy.

function allowlistFromEnv(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
}

export function isPlatformAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false
  const allowlist = allowlistFromEnv()
  if (allowlist.length === 0) return false
  return allowlist.includes(email.toLowerCase())
}
