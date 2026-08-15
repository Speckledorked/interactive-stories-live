'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getUser } from '@/lib/clientAuth'
import { Input } from '@/components/ui/input'

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
        description: 'Browse NPCs, factions, and threads',
        icon: '📚',
        action: () => router.push(`/campaigns/${campaignId}/wiki`),
        keywords: ['wiki', 'npcs', 'factions', 'clocks', 'threads'],
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
      <div className="w-full max-w-2xl mx-4 bg-myth-surface-raised border border-myth-border rounded-xl shadow-2xl overflow-hidden">
        {/* Search Input */}
        <div className="relative">
          <Input
            wrapperClassName="w-full min-h-[44px]" className="border-b"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type a command or search..."
            autoFocus
          />
          <div className="absolute right-4 top-4 text-xs text-myth-ink-faint">
            <kbd className="px-2 py-1 bg-myth-surface-sunken rounded border border-myth-border font-mono text-myth-ink-muted">ESC</kbd>
          </div>
        </div>

        {/* Commands List */}
        <div className="max-h-[400px] overflow-y-auto">
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-myth-ink-faint">
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
                    <div className="px-4 py-2 font-mono text-xs font-semibold text-myth-ink-faint uppercase tracking-wider">
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
                          className={`w-full min-h-[44px] px-4 py-3 text-left flex items-center gap-3 transition-colors ${
                            isSelected
                              ? 'bg-myth-accent text-myth-accent-ink'
                              : 'hover:bg-myth-surface-sunken text-myth-ink-muted'
                          }`}
                        >
                          <span className="text-2xl">{cmd.icon}</span>
                          <div className="flex-1">
                            <div className={`font-medium ${isSelected ? 'text-myth-accent-ink' : 'text-myth-ink'}`}>
                              {cmd.name}
                            </div>
                            {cmd.description && (
                              <div className={`text-sm ${isSelected ? 'text-myth-accent-ink/80' : 'text-myth-ink-faint'}`}>
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
        <div className="px-4 py-3 bg-myth-surface-sunken border-t border-myth-border flex items-center justify-between text-xs text-myth-ink-faint">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-myth-surface rounded border border-myth-border font-mono">↑↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-myth-surface rounded border border-myth-border font-mono">↵</kbd>
              Select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-myth-surface rounded border border-myth-border font-mono">ESC</kbd>
              Close
            </span>
          </div>
          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-myth-surface rounded border border-myth-border font-mono">⌘K</kbd>
            <span>or</span>
            <kbd className="px-1.5 py-0.5 bg-myth-surface rounded border border-myth-border font-mono">Ctrl+K</kbd>
          </div>
        </div>
      </div>
    </div>
  )
}
