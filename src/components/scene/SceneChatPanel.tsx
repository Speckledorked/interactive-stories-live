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

  // ChatPanel is already a complete, self-styled card — no outer wrapper
  // here, to avoid the double card chrome the old ember theme had.
  return (
    <ChatPanel
      campaignId={campaignId}
      currentUserId={user.id}
      currentUserName={user.name || user.email}
      userCharacters={userCharacters}
      sceneId={currentScene.id}
      icOnly={true}
    />
  )
}
