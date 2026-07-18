interface Membership {
  id: string
  role: 'ADMIN' | 'PLAYER'
  user: { id: string; name?: string | null; email: string; isOnline?: boolean }
}

export function PlayersPanel({
  memberships,
  currentUserId,
  blockedUserIds,
  blockingUserId,
  onToggleBlock,
  isAdmin,
  onInvite,
}: {
  memberships: Membership[]
  currentUserId: string | undefined
  blockedUserIds: string[]
  blockingUserId: string | null
  onToggleBlock: (userId: string) => void
  isAdmin: boolean
  onInvite: () => void
}) {
  return (
    <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-myth-ink">Players ({memberships.length})</h2>
        {isAdmin && (
          <button id="invite-button" type="button" onClick={onInvite} className="text-sm text-myth-ink-muted hover:text-myth-ink" title="Invite players">
            + Invite
          </button>
        )}
      </div>
      <div className="space-y-2">
        {memberships.map((member) => {
          const isSelf = member.user.id === currentUserId
          const isBlocked = blockedUserIds.includes(member.user.id)
          return (
            <div key={member.id} className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${member.user.isOnline ? 'bg-myth-good' : 'bg-myth-ink-faint/40'}`}
                />
                <span className="truncate text-sm text-myth-ink">{member.user.name || member.user.email}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wide text-myth-ink-faint">{member.role}</span>
                {!isSelf && (
                  <button
                    type="button"
                    onClick={() => onToggleBlock(member.user.id)}
                    disabled={blockingUserId === member.user.id}
                    title={isBlocked ? 'Unblock — show their messages again' : 'Block — hide their messages from you'}
                    className={`text-xs transition-colors disabled:opacity-50 ${
                      isBlocked ? 'text-myth-danger hover:text-myth-danger' : 'text-myth-ink-faint hover:text-myth-ink-muted'
                    }`}
                  >
                    {isBlocked ? 'Unblock' : 'Block'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
