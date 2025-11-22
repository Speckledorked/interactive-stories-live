'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getUser } from '@/lib/clientAuth'

interface Command {
  id: string
  name: string
  description?: string
  icon?: string
  action: () => void
  keywords?: string[]
  category: 'navigation' | 'actions' | 'shortcuts'
}

interface CommandPaletteProps {
  campaignId?: string
  characterId?: string
  sceneId?: string
  onAction?: (action: string) => void
}

export default function CommandPalette({
  campaignId,
  characterId,
  sceneId,
  onAction
}: CommandPaletteProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Build available commands based on context
  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = []

    // Navigation commands
    if (campaignId) {
      cmds.push({
        id: 'nav-overview',
        name: 'Go to Campaign Overview',
        description: 'View campaign dashboard',
        icon: '🏠',
        action: () => router.push(`/campaigns/${campaignId}`),
        keywords: ['overview', 'home', 'dashboard'],
        category: 'navigation'
      })

      cmds.push({
        id: 'nav-story',
        name: 'Go to Story',
        description: 'Enter the active scene',
        icon: '🎭',
        action: () => router.push(`/campaigns/${campaignId}/story`),
        keywords: ['story', 'scene', 'play'],
        category: 'navigation'
      })

      cmds.push({
        id: 'nav-characters',
        name: 'View Characters',
        description: 'See all campaign characters',
        icon: '👥',
        action: () => router.push(`/campaigns/${campaignId}/characters`),
        keywords: ['characters', 'party', 'players'],
        category: 'navigation'
      })

      cmds.push({
        id: 'nav-story-log',
        name: 'View Story Log',
        description: 'Read campaign history',
        icon: '📜',
        action: () => router.push(`/campaigns/${campaignId}/story-log`),
        keywords: ['log', 'history', 'timeline'],
        category: 'navigation'
      })

      cmds.push({
        id: 'nav-wiki',
        name: 'Open Wiki',
        description: 'Browse NPCs, factions, and clocks',
        icon: '📚',
        action: () => router.push(`/campaigns/${campaignId}/wiki`),
        keywords: ['wiki', 'npcs', 'factions', 'clocks'],
        category: 'navigation'
      })

      cmds.push({
        id: 'nav-maps',
        name: 'View Maps',
        description: 'See campaign maps',
        icon: '🗺️',
        action: () => router.push(`/campaigns/${campaignId}`),
        keywords: ['maps', 'locations'],
        category: 'navigation'
      })
    }

    // General navigation
    cmds.push({
      id: 'nav-campaigns',
      name: 'Go to Campaigns',
      description: 'View all campaigns',
      icon: '🎲',
      action: () => router.push('/campaigns'),
      keywords: ['campaigns', 'all'],
      category: 'navigation'
    })

    cmds.push({
      id: 'nav-settings',
      name: 'Go to Settings',
      description: 'User preferences',
      icon: '⚙️',
      action: () => router.push('/settings'),
      keywords: ['settings', 'preferences'],
      category: 'navigation'
    })

    // Action commands (if callbacks provided)
    if (onAction) {
      if (pathname?.includes('/story')) {
        cmds.push({
          id: 'action-submit',
          name: 'Submit Action',
          description: 'Submit your character action',
          icon: '✍️',
          action: () => {
            onAction('submit-action')
            setIsOpen(false)
          },
          keywords: ['submit', 'action', 'play'],
          category: 'actions'
        })

        cmds.push({
          id: 'action-resolve',
          name: 'Resolve Exchange',
          description: 'GM: Resolve the current exchange',
          icon: '🎬',
          action: () => {
            onAction('resolve-exchange')
            setIsOpen(false)
          },
          keywords: ['resolve', 'gm', 'exchange'],
          category: 'actions'
        })

        cmds.push({
          id: 'action-end-scene',
          name: 'End Scene',
          description: 'GM: End the current scene',
          icon: '🏁',
          action: () => {
            onAction('end-scene')
            setIsOpen(false)
          },
          keywords: ['end', 'scene', 'finish', 'gm'],
          category: 'actions'
        })
      }

      cmds.push({
        id: 'action-create-character',
        name: 'Create Character',
        description: 'Create a new character',
        icon: '➕',
        action: () => {
          onAction('create-character')
          setIsOpen(false)
        },
        keywords: ['create', 'character', 'new'],
        category: 'actions'
      })
    }

    // Keyboard shortcuts info
    cmds.push({
      id: 'shortcut-help',
      name: 'View Keyboard Shortcuts',
      description: 'See all available shortcuts',
      icon: '⌨️',
      action: () => {
        onAction?.('show-shortcuts')
        setIsOpen(false)
      },
      keywords: ['shortcuts', 'keyboard', 'help'],
      category: 'shortcuts'
    })

    return cmds
  }, [campaignId, characterId, sceneId, pathname, router, onAction])

  // Filter commands based on search
  const filteredCommands = useMemo(() => {
    if (!search.trim()) return commands

    const searchLower = search.toLowerCase()
    return commands.filter(cmd => {
      const nameMatch = cmd.name.toLowerCase().includes(searchLower)
      const descMatch = cmd.description?.toLowerCase().includes(searchLower)
      const keywordMatch = cmd.keywords?.some(kw => kw.toLowerCase().includes(searchLower))
      return nameMatch || descMatch || keywordMatch
    })
  }, [commands, search])

  // Keyboard shortcut to open/close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K to toggle
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen(prev => !prev)
        setSearch('')
        setSelectedIndex(0)
      }

      // Escape to close
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
        setSearch('')
      }

      // Arrow navigation
      if (isOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedIndex(prev =>
            prev < filteredCommands.length - 1 ? prev + 1 : prev
          )
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0))
        } else if (e.key === 'Enter') {
          e.preventDefault()
          if (filteredCommands[selectedIndex]) {
            filteredCommands[selectedIndex].action()
            setIsOpen(false)
            setSearch('')
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, filteredCommands, selectedIndex])

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [search])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl mx-4 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden">
        {/* Search Input */}
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type a command or search..."
            className="w-full px-4 py-4 bg-gray-900 text-white placeholder-gray-500 focus:outline-none border-b border-gray-700"
            autoFocus
          />
          <div className="absolute right-4 top-4 text-xs text-gray-500">
            <kbd className="px-2 py-1 bg-gray-800 rounded border border-gray-700">ESC</kbd>
          </div>
        </div>

        {/* Commands List */}
        <div className="max-h-[400px] overflow-y-auto">
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500">
              No commands found for "{search}"
            </div>
          ) : (
            <div className="py-2">
              {/* Group by category */}
              {['navigation', 'actions', 'shortcuts'].map(category => {
                const categoryCommands = filteredCommands.filter(cmd => cmd.category === category)
                if (categoryCommands.length === 0) return null

                return (
                  <div key={category}>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {category}
                    </div>
                    {categoryCommands.map((cmd, idx) => {
                      const globalIndex = filteredCommands.indexOf(cmd)
                      const isSelected = globalIndex === selectedIndex

                      return (
                        <button
                          key={cmd.id}
                          onClick={() => {
                            cmd.action()
                            setIsOpen(false)
                            setSearch('')
                          }}
                          onMouseEnter={() => setSelectedIndex(globalIndex)}
                          className={`w-full px-4 py-3 text-left flex items-center gap-3 transition-colors ${
                            isSelected
                              ? 'bg-primary-600 text-white'
                              : 'hover:bg-gray-800 text-gray-300'
                          }`}
                        >
                          <span className="text-2xl">{cmd.icon}</span>
                          <div className="flex-1">
                            <div className={`font-medium ${isSelected ? 'text-white' : 'text-gray-200'}`}>
                              {cmd.name}
                            </div>
                            {cmd.description && (
                              <div className={`text-sm ${isSelected ? 'text-primary-100' : 'text-gray-500'}`}>
                                {cmd.description}
                              </div>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-gray-800/50 border-t border-gray-700 flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">↑↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">↵</kbd>
              Select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">ESC</kbd>
              Close
            </span>
          </div>
          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">⌘K</kbd>
            <span>or</span>
            <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">Ctrl+K</kbd>
          </div>
        </div>
      </div>
    </div>
  )
}
