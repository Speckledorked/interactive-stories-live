// src/lib/monitoring.ts
// Minimal error monitoring: every reported error is console.error'd (so
// platform logs always have it) and, when ERROR_WEBHOOK_URL is set,
// POSTed to that webhook. The payload includes a Discord/Slack-compatible
// `content`/`text` field, so a free chat webhook turns production
// failures into phone notifications — the solo-operator Sentry.
//
// Deliberately not a Sentry SDK integration: no build wrapping, no
// sampling config, nothing to misconfigure. If/when the project adopts
// Sentry, this function body is the only thing that changes.

const WEBHOOK_TIMEOUT_MS = 3000

export async function reportError(
  context: string,
  error: unknown,
  extra?: Record<string, string | number | undefined>
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`🚨 [${context}]`, message, extra || '')

  const url = process.env.ERROR_WEBHOOK_URL
  if (!url) return

  const extraText = extra
    ? Object.entries(extra)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
    : ''
  const line = `🚨 **MythOS** ${context}: ${message}${extraText ? `\n${extraText}` : ''}`.slice(0, 1900)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `content` for Discord, `text` for Slack — receivers ignore the other.
      body: JSON.stringify({ content: line, text: line }),
      signal: controller.signal,
    })
  } catch {
    // Monitoring must never cascade a failure.
  } finally {
    clearTimeout(timer)
  }
}
