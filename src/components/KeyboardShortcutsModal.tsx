'use client'

import { useEffect } from 'react'
import { authenticatedFetch, getUser } from '@/lib/clientAuth'

interface ShortcutGroup {
  title: string
  shortcuts: Array<{
    keys: string[]
    description: string
  }>
}

interface KeyboardShortcutsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  // Trigger tutorial completion when modal opens
  useEffect(() => {
    if (isOpen) {
      const user = getUser()
      if (user?.id) {
        // Trigger the 'shortcuts_viewed' event for tutorial tracking
        authenticatedFetch('/api/tutorial/trigger', {
          method: 'POST',
          body: JSON.stringify({ trigger: 'shortcuts_viewed' })
        }).catch(err => console.error('Failed to track tutorial event:', err))
      }
    }
  }, [isOpen])

  if (!isOpen) return null

  const shortcutGroups: ShortcutGroup[] = [
    {
      title: 'General',
      shortcuts: [
        { keys: ['⌘', 'K'], description: 'Open command palette' },
        { keys: ['Ctrl', 'K'], description: 'Open command palette (Windows/Linux)' },
        { keys: ['ESC'], description: 'Close modal/dialog' },
        { keys: ['?'], description: 'Show keyboard shortcuts' },
      ]
    },
    {
      title: 'Navigation',
      shortcuts: [
        { keys: ['G', 'H'], description: 'Go to campaign overview' },
        { keys: ['G', 'S'], description: 'Go to story/scene' },
        { keys: ['G', 'C'], description: 'Go to characters' },
        { keys: ['G', 'L'], description: 'Go to story log' },
        { keys: ['G', 'W'], description: 'Go to wiki' },
      ]
    },
    {
      title: 'In Scene (Story Page)',
      shortcuts: [
        { keys: ['⌘', 'Enter'], description: 'Submit action' },
        { keys: ['⌘', 'R'], description: 'Resolve exchange (GM)' },
        { keys: ['⌘', 'E'], description: 'End scene (GM)' },
        { keys: ['⌘', 'N'], description: 'Start new scene (GM)' },
      ]
    },
    {
      title: 'Command Palette',
      shortcuts: [
        { keys: ['↑', '↓'], description: 'Navigate commands' },
        { keys: ['Enter'], description: 'Execute selected command' },
        { keys: ['ESC'], description: 'Close palette' },
      ]
    },
    {
      title: 'Quick Actions',
      shortcuts: [
        { keys: ['⌘', 'P'], description: 'Create character' },
        { keys: ['⌘', 'M'], description: 'View maps' },
        { keys: ['⌘', '/'], description: 'Toggle chat' },
      ]
    }
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-4xl mx-4 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">Keyboard Shortcuts</h2>
            <p className="text-sm text-gray-400 mt-1">Speed up your workflow with these shortcuts</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-2 hover:bg-gray-800 rounded transition-colors"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {shortcutGroups.map((group, idx) => (
              <div key={idx}>
                <h3 className="text-sm font-semibold text-primary-400 uppercase tracking-wider mb-4">
                  {group.title}
                </h3>
                <div className="space-y-3">
                  {group.shortcuts.map((shortcut, sIdx) => (
                    <div key={sIdx} className="flex items-center justify-between gap-4">
                      <span className="text-gray-300 text-sm flex-1">{shortcut.description}</span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, kIdx) => (
                          <span key={kIdx} className="inline-flex items-center">
                            <kbd className="px-2.5 py-1.5 text-xs font-semibold bg-gray-800 border border-gray-600 rounded shadow-sm text-gray-200 min-w-[32px] text-center">
                              {key}
                            </kbd>
                            {kIdx < shortcut.keys.length - 1 && (
                              <span className="mx-1 text-gray-600">+</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-800/50 border-t border-gray-700">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                All shortcuts work globally
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                Some are context-specific
              </span>
            </div>
            <span>Press <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">ESC</kbd> to close</span>
          </div>
        </div>
      </div>
    </div>
  )
}
