'use client'

import { createContext, useContext, useState, ReactNode, useCallback } from 'react'
import CommandPalette from '@/components/CommandPalette'

interface CommandPaletteContextType {
  openPalette: () => void
  closePalette: () => void
  setContext: (context: CommandPaletteConfig) => void
  registerAction: (action: string, handler: () => void) => void
}

interface CommandPaletteConfig {
  campaignId?: string
  characterId?: string
  sceneId?: string
}

const CommandPaletteContext = createContext<CommandPaletteContextType | undefined>(undefined)

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [context, setContextState] = useState<CommandPaletteConfig>({})
  const [actionHandlers, setActionHandlers] = useState<Record<string, () => void>>({})

  const openPalette = useCallback(() => {
    // Palette opens via keyboard shortcut, managed internally by CommandPalette component
  }, [])

  const closePalette = useCallback(() => {
    // Palette closes via keyboard shortcut, managed internally by CommandPalette component
  }, [])

  const setContext = useCallback((newContext: CommandPaletteConfig) => {
    setContextState(newContext)
  }, [])

  const registerAction = useCallback((action: string, handler: () => void) => {
    setActionHandlers(prev => ({ ...prev, [action]: handler }))
  }, [])

  const handleAction = useCallback((action: string) => {
    if (actionHandlers[action]) {
      actionHandlers[action]()
    }
  }, [actionHandlers])

  return (
    <CommandPaletteContext.Provider value={{ openPalette, closePalette, setContext, registerAction }}>
      {children}
      <CommandPalette
        campaignId={context.campaignId}
        characterId={context.characterId}
        sceneId={context.sceneId}
        onAction={handleAction}
      />
    </CommandPaletteContext.Provider>
  )
}

export function useCommandPalette() {
  const context = useContext(CommandPaletteContext)
  if (!context) {
    throw new Error('useCommandPalette must be used within CommandPaletteProvider')
  }
  return context
}
