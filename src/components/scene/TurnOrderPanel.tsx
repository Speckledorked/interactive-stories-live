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
          className="w-full text-xs text-ember-400/50 hover:text-ember-200 transition-colors disabled:opacity-50"
        >
          {endingTurnOrder ? 'Ending…' : 'End turn order'}
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
      <h3 className="text-sm font-bold text-ember-300/60 uppercase tracking-wide mb-2">Turn Order</h3>
      <p className="text-xs text-ember-400/50 mb-3">
        Play is freeform by default — anyone can act anytime. Turn this on if you'd rather the party go in order for this scene; it's just a visible queue and timer, submitting an action is never blocked by it.
      </p>
      <button
        onClick={onEnableTurnOrder}
        disabled={enablingTurnOrder}
        className="btn-secondary py-2 px-4 text-sm w-full"
      >
        {enablingTurnOrder ? 'Enabling…' : 'Enable turn order'}
      </button>
    </div>
  )
}
