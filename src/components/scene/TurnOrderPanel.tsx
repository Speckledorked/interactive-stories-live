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

  // Compact single row rather than a full card — most scenes never turn
  // this on, so the common case shouldn't cost a whole card's worth of
  // height explaining an opt-in feature. Full explanation lives in a
  // title tooltip instead of always-visible body text.
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-myth-border bg-myth-surface px-4 py-3"
      title="Play is freeform by default — anyone can act anytime. Turn order is just a visible queue and timer; submitting an action is never blocked by it."
    >
      <p className="text-xs text-myth-ink-faint">Play is freeform — anyone can act anytime.</p>
      <button
        onClick={onEnableTurnOrder}
        disabled={enablingTurnOrder}
        className="shrink-0 rounded-md border border-myth-border px-3 py-1.5 text-xs font-medium text-myth-ink-muted transition-colors hover:border-myth-border-strong hover:text-myth-ink disabled:opacity-50"
      >
        {enablingTurnOrder ? 'Enabling…' : 'Enable turn order'}
      </button>
    </div>
  )
}
