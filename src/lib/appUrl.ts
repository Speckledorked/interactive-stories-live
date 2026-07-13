// src/lib/appUrl.ts
// The one place absolute URLs (invite links, email links, checkout
// redirects) get their base from. NEXT_PUBLIC_APP_URL is the intended
// source, but on a deployment where it isn't configured for that
// environment (e.g. Preview, which Vercel scopes separately from
// Production), falling straight to localhost produces broken links players
// can't use. VERCEL_URL is always set by the platform itself, so it's a
// real fallback instead of a placeholder.
export function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}
