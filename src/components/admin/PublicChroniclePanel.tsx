import { Badge } from '@/components/ui/badge'
import { SectionHeader } from '@/components/ui/section-header'

export function PublicChroniclePanel({
  chronicleShare,
  chronicleShareLoading,
  onEnable,
  onDisable,
}: {
  chronicleShare: { enabled: boolean; token: string | null } | null
  chronicleShareLoading: boolean
  onEnable: () => void
  onDisable: () => void
}) {
  return (
    <section>
      <SectionHeader title="Public Chronicle Link" action={chronicleShare?.enabled ? <Badge variant="public">Public</Badge> : undefined} />
      <div className="mt-3 rounded-lg border border-myth-border bg-myth-surface p-5">
        <p className="mb-4 text-sm text-myth-ink-muted">
          A read-only, no-login-required page showing every resolved scene in order — nothing else (no character
          sheets, no admin data). Off by default; share it as far as you like once on.
        </p>
        {chronicleShare?.enabled ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={typeof window !== 'undefined' ? `${window.location.origin}/chronicle/${chronicleShare.token}` : ''}
                className="flex-1 rounded-md border border-myth-border bg-myth-surface-sunken px-3 py-2 font-mono text-sm text-myth-ink"
                onFocus={(e) => e.target.select()}
              />
              <button
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    navigator.clipboard.writeText(`${window.location.origin}/chronicle/${chronicleShare.token}`)
                  }
                }}
                className="shrink-0 rounded-md border border-myth-border px-3 py-2 text-sm text-myth-ink-muted hover:border-myth-border-strong hover:text-myth-ink"
              >
                Copy
              </button>
            </div>
            <button
              onClick={onDisable}
              disabled={chronicleShareLoading}
              className="rounded-md border border-myth-danger/40 px-4 py-2 text-sm text-myth-danger transition-colors hover:bg-myth-danger/10 disabled:opacity-50"
            >
              Disable Public Link
            </button>
          </div>
        ) : (
          <button
            onClick={onEnable}
            disabled={chronicleShareLoading}
            className="rounded-md bg-myth-accent px-4 py-2 text-sm font-medium text-myth-accent-ink transition-colors hover:bg-myth-accent-hover disabled:opacity-50"
          >
            {chronicleShareLoading ? 'Enabling...' : 'Enable Public Link'}
          </button>
        )}
      </div>
    </section>
  )
}
