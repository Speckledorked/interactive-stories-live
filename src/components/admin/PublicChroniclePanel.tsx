import { Badge } from '@/components/ui/badge'
import { SectionHeader } from '@/components/ui/section-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
              <Input
                wrapperClassName="flex-1" className="font-mono"
                type="text"
                readOnly
                value={typeof window !== 'undefined' ? `${window.location.origin}/chronicle/${chronicleShare.token}` : ''}
                onFocus={(e) => e.target.select()}
              />
              <Button
                variant="secondary"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    navigator.clipboard.writeText(`${window.location.origin}/chronicle/${chronicleShare.token}`)
                  }
                }}
              >
                Copy
              </Button>
            </div>
            <Button
              variant="danger"
              onClick={onDisable}
              disabled={chronicleShareLoading}
            >
              Disable Public Link
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            onClick={onEnable}
            disabled={chronicleShareLoading}
          >
            {chronicleShareLoading ? 'Enabling...' : 'Enable Public Link'}
          </Button>
        )}
      </div>
    </section>
  )
}
