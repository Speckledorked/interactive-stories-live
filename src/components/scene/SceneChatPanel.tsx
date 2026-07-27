// src/components/scene/SceneChatPanel.tsx
// Split out of story/page.tsx's sidebar — see CharacterSelectorPanel's
// header comment for why.

'use client'

import ChatPanel from '@/components/chat/ChatPanel'

interface SceneChatPanelProps {
  currentScene: any
  user: any
  campaignId: string
  userCharacters: any[]
}

export function SceneChatPanel({ currentScene, user, campaignId, userCharacters }: SceneChatPanelProps) {
  if (!currentScene || !user) return null

  return (
    <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-0">
      <ChatPanel
        campaignId={campaignId}
        currentUserId={user.id}
        currentUserName={user.name || user.email}
        userCharacters={userCharacters}
        sceneId={currentScene.id}
        icOnly={true}
      />
    </div>
  )
}
