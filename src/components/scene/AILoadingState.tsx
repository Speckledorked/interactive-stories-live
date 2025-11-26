// src/components/scene/AILoadingState.tsx
// Enhanced loading animation for AI operations

'use client'

import { useState, useEffect } from 'react'

interface AILoadingStateProps {
  message?: string
  type?: 'scene' | 'resolution' | 'general'
  showProgress?: boolean
}

export default function AILoadingState({
  message,
  type = 'general',
  showProgress = false
}: AILoadingStateProps) {
  const [dots, setDots] = useState('')
  const [messageIndex, setMessageIndex] = useState(0)

  const messages = {
    scene: [
      'The AI is crafting your scene...',
      'Weaving narrative threads...',
      'Setting the stage...',
      'Creating dramatic tension...',
      'Painting the world...'
    ],
    resolution: [
      'The dice have spoken. Let\'s see what happens...',
      'NPCs are making their moves...',
      'Consequences rippling through the world...',
      'The GM is narrating what unfolds...',
      'Your actions have set things in motion...',
      'The story twists and turns...',
      'Villains respond to your interference...',
      'The world reacts to your choices...'
    ],
    general: [
      'Processing...',
      'Thinking...',
      'Working on it...'
    ]
  }

  const currentMessages = messages[type]

  useEffect(() => {
    // Animate dots
    const dotsInterval = setInterval(() => {
      setDots(prev => (prev.length >= 3 ? '' : prev + '.'))
    }, 500)

    // Cycle through messages
    const messageInterval = setInterval(() => {
      setMessageIndex(prev => (prev + 1) % currentMessages.length)
    }, 3000)

    return () => {
      clearInterval(dotsInterval)
      clearInterval(messageInterval)
    }
  }, [currentMessages.length])

  return (
    <div className="flex flex-col items-center justify-center p-12">
      {/* Animated Icon */}
      <div className="relative mb-6">
        {/* Outer ring */}
        <div className="absolute inset-0 rounded-full border-4 border-primary-500/20" />

        {/* Spinning ring */}
        <div className="relative">
          <div className="w-20 h-20 rounded-full border-4 border-transparent border-t-primary-500 border-r-primary-500 animate-spin" />
        </div>

        {/* Center icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-4xl animate-pulse">
            {type === 'scene' ? '🎭' : type === 'resolution' ? '⚡' : '🤖'}
          </div>
        </div>

        {/* Pulsing glow */}
        <div className="absolute inset-0 rounded-full bg-primary-500/10 animate-ping" style={{ animationDuration: '2s' }} />
      </div>

      {/* Message */}
      <div className="text-center">
        <p className="text-lg font-medium text-white mb-2 min-h-[2rem]">
          {message || currentMessages[messageIndex]}
          <span className="inline-block w-8 text-left">{dots}</span>
        </p>
        <p className="text-sm text-gray-400">
          This may take a few moments
        </p>
      </div>

      {/* Progress bar (optional) */}
      {showProgress && (
        <div className="w-full max-w-md mt-6">
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-primary-500 to-primary-600 animate-pulse" style={{ width: '60%' }} />
          </div>
        </div>
      )}

      {/* Floating particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 bg-primary-500/30 rounded-full animate-float"
            style={{
              left: `${20 + i * 15}%`,
              animationDelay: `${i * 0.5}s`,
              animationDuration: `${3 + i}s`
            }}
          />
        ))}
      </div>

      <style jsx>{`
        @keyframes float {
          0%, 100% {
            transform: translateY(0) translateX(0);
            opacity: 0;
          }
          50% {
            opacity: 1;
          }
          100% {
            transform: translateY(-100px) translateX(20px);
            opacity: 0;
          }
        }
        .animate-float {
          animation: float linear infinite;
        }
      `}</style>
    </div>
  )
}

// Simple inline loader for smaller contexts
export function AIInlineLoader({ text = 'Loading' }: { text?: string }) {
  const [dots, setDots] = useState('')

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => (prev.length >= 3 ? '' : prev + '.'))
    }, 500)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="inline-flex items-center gap-2 text-primary-400">
      <div className="w-4 h-4 border-2 border-transparent border-t-primary-500 border-r-primary-500 rounded-full animate-spin" />
      <span>{text}<span className="inline-block w-6 text-left">{dots}</span></span>
    </div>
  )
}
