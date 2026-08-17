// src/components/scene/TurnOrderPanel.tsx
// Split out of story/page.tsx's sidebar — see CharacterSelectorPanel's
// header comment for why. Turn order is an opt-in advisory queue any
// player can enable or end (a table-level convention, not a GM power —
// there is no human GM). See TurnTracker's doc comment for why it never
// gates action submission.

'use client'

import TurnTracker from '@/components/turns/TurnTracker'
import { Button } from '@/components/ui/button'

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
        {/* The load-bearing rule, and the one place it was missing.
            It used to live only in a hover `title=` on the DISABLED
            state — invisible to every touch user, on a mobile-first
            product, and absent from the one state where a player would
            actually assume the opposite. A queue with a highlighted
            "current" player reads as a lock unless something says
            otherwise, so it says otherwise. */}
        <p className="text-xs leading-relaxed text-myth-ink-faint">
          The queue is a suggestion, not a lock — you can submit an action
          whenever you like, including when it is not your turn.
        </p>
        <Button
          variant="ghost" size="sm" className="w-full"
          onClick={onEndTurnOrder}
          disabled={endingTurnOrder}
        >
          {endingTurnOrder ? 'Ending…' : 'End turn order'}
        </Button>
      </div>
    )
  }

  // Compact single row rather than a full card — most scenes never turn
  // this on, so the common case shouldn't cost a whole card's worth of
  // height explaining an opt-in feature.
  //
  // The `title=` that used to carry the full rule here is gone: a hover
  // tooltip is unreadable on a phone, and the visible line below already
  // says the part that matters in this state. The rest of the rule now
  // appears in the ENABLED branch above, where it is actually needed.
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-myth-border bg-myth-surface px-4 py-3">
      <p className="text-xs text-myth-ink-faint">Play is freeform — anyone can act anytime.</p>
      <Button
        variant="secondary" size="sm" className="shrink-0"
        onClick={onEnableTurnOrder}
        disabled={enablingTurnOrder}
      >
        {enablingTurnOrder ? 'Enabling…' : 'Enable turn order'}
      </Button>
    </div>
  )
}
