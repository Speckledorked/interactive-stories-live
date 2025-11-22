'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'

interface UseKeyboardShortcutsProps {
  campaignId?: string
  onSubmitAction?: () => void
  onResolveExchange?: () => void
  onEndScene?: () => void
  onStartScene?: () => void
  onCreateCharacter?: () => void
  onToggleChat?: () => void
  onShowShortcuts?: () => void
}

export function useKeyboardShortcuts(props: UseKeyboardShortcutsProps = {}) {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      // Command/Ctrl shortcuts
      if (e.metaKey || e.ctrlKey) {
        // Cmd+Enter - Submit action
        if (e.key === 'Enter' && props.onSubmitAction) {
          e.preventDefault()
          props.onSubmitAction()
          return
        }

        // Cmd+R - Resolve exchange (GM)
        if (e.key === 'r' && props.onResolveExchange) {
          e.preventDefault()
          props.onResolveExchange()
          return
        }

        // Cmd+E - End scene (GM)
        if (e.key === 'e' && props.onEndScene) {
          e.preventDefault()
          props.onEndScene()
          return
        }

        // Cmd+N - Start new scene (GM)
        if (e.key === 'n' && props.onStartScene) {
          e.preventDefault()
          props.onStartScene()
          return
        }

        // Cmd+P - Create character
        if (e.key === 'p' && props.onCreateCharacter) {
          e.preventDefault()
          props.onCreateCharacter()
          return
        }

        // Cmd+M - View maps
        if (e.key === 'm' && props.campaignId) {
          e.preventDefault()
          router.push(`/campaigns/${props.campaignId}`)
          return
        }

        // Cmd+/ - Toggle chat
        if (e.key === '/' && props.onToggleChat) {
          e.preventDefault()
          props.onToggleChat()
          return
        }
      }

      // G shortcuts (like GitHub/Linear)
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Wait for next key
        const handleSecondKey = (e2: KeyboardEvent) => {
          window.removeEventListener('keydown', handleSecondKey)

          if (!props.campaignId) return

          switch (e2.key) {
            case 'h': // Go to home/overview
              router.push(`/campaigns/${props.campaignId}`)
              break
            case 's': // Go to story
              router.push(`/campaigns/${props.campaignId}/story`)
              break
            case 'c': // Go to characters
              router.push(`/campaigns/${props.campaignId}/characters`)
              break
            case 'l': // Go to story log
              router.push(`/campaigns/${props.campaignId}/story-log`)
              break
            case 'w': // Go to wiki
              router.push(`/campaigns/${props.campaignId}/wiki`)
              break
          }
        }

        window.addEventListener('keydown', handleSecondKey)

        // Remove listener after 1 second if no second key pressed
        setTimeout(() => {
          window.removeEventListener('keydown', handleSecondKey)
        }, 1000)
      }

      // ? - Show keyboard shortcuts
      if (e.key === '?' && props.onShowShortcuts) {
        e.preventDefault()
        props.onShowShortcuts()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    router,
    pathname,
    props.campaignId,
    props.onSubmitAction,
    props.onResolveExchange,
    props.onEndScene,
    props.onStartScene,
    props.onCreateCharacter,
    props.onToggleChat,
    props.onShowShortcuts
  ])
}
