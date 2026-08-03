// src/components/scene/TurnOrderPanel.tsx
// Split out of story/page.tsx's sidebar — see CharacterSelectorPanel's
// header comment for why. Turn order is an opt-in advisory queue any
// player can enable or end (a table-level convention, not a GM power —
// there is no human GM). See TurnTracker's doc comment for why it never
// gates action submission.

'use client'

import TurnTracker from '@/components/turns/TurnTracker'

interface TurnOrderPanelProps {
  currentScene: any
  sceneTurnInfo: any
  campaignId: string
  currentUserId: string
  isHost: boolean
  onEndTurnOrder: () => void
  endingTurnOrder: boolean
  onEnableTurnOrder: () => void
  enablingTurnOrder: boolean
}

export function TurnOrderPanel({
  currentScene,
  sceneTurnInfo,
  campaignId,
  currentUserId,
  isHost,
  onEndTurnOrder,
  endingTurnOrder,
  onEnableTurnOrder,
  enablingTurnOrder,
}: TurnOrderPanelProps) {
  if (!currentScene) return null

  if (sceneTurnInfo) {
    return (
      <div className="space-y-2">
        <TurnTracker
          campaignId={campaignId}
          sceneId={currentScene.id}
          currentUserId={currentUserId}
          isHost={isHost}
        />
        <button
          onClick={onEndTurnOrder}
          disabled={endingTurnOrder}
          className="w-full text-xs text-myth-ink-faint hover:text-myth-ink transition-colors disabled:opacity-50"
        >
          {endingTurnOrder ? 'Ending…' : 'End turn order'}
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-myth-border bg-myth-surface p-5">
      <h3 className="text-sm font-medium text-myth-ink-faint uppercase tracking-wide mb-2">Turn Order</h3>
      <p className="text-xs text-myth-ink-muted mb-3">
        Play is freeform by default — anyone can act anytime. Turn this on if you'd rather the party go in order for this scene; it's just a visible queue and timer, submitting an action is never blocked by it.
      </p>
      <button
        onClick={onEnableTurnOrder}
        disabled={enablingTurnOrder}
        className="rounded-md border border-myth-border py-2 px-4 text-sm font-medium text-myth-ink-muted transition-colors hover:border-myth-border-strong hover:text-myth-ink w-full disabled:opacity-50"
      >
        {enablingTurnOrder ? 'Enabling…' : 'Enable turn order'}
      </button>
    </div>
  )
}
