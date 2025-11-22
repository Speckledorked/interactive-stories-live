// src/components/scene/SceneMoodTag.tsx
// Visual mood/tone indicators for scenes

'use client'

export type SceneMood =
  | 'combat'
  | 'social'
  | 'investigation'
  | 'stealth'
  | 'exploration'
  | 'downtime'
  | 'dramatic'
  | 'tense'
  | 'peaceful'

interface SceneMoodTagProps {
  mood: SceneMood
  size?: 'sm' | 'md' | 'lg'
}

export default function SceneMoodTag({ mood, size = 'md' }: SceneMoodTagProps) {
  const getMoodConfig = () => {
    switch (mood) {
      case 'combat':
        return {
          icon: '⚔️',
          label: 'Combat',
          bg: 'bg-red-900/30',
          border: 'border-red-700',
          text: 'text-red-300',
          glow: 'shadow-red-500/20'
        }
      case 'social':
        return {
          icon: '💬',
          label: 'Social',
          bg: 'bg-blue-900/30',
          border: 'border-blue-700',
          text: 'text-blue-300',
          glow: 'shadow-blue-500/20'
        }
      case 'investigation':
        return {
          icon: '🔍',
          label: 'Investigation',
          bg: 'bg-purple-900/30',
          border: 'border-purple-700',
          text: 'text-purple-300',
          glow: 'shadow-purple-500/20'
        }
      case 'stealth':
        return {
          icon: '🌙',
          label: 'Stealth',
          bg: 'bg-gray-900/30',
          border: 'border-gray-700',
          text: 'text-gray-300',
          glow: 'shadow-gray-500/20'
        }
      case 'exploration':
        return {
          icon: '🗺️',
          label: 'Exploration',
          bg: 'bg-green-900/30',
          border: 'border-green-700',
          text: 'text-green-300',
          glow: 'shadow-green-500/20'
        }
      case 'downtime':
        return {
          icon: '☕',
          label: 'Downtime',
          bg: 'bg-yellow-900/30',
          border: 'border-yellow-700',
          text: 'text-yellow-300',
          glow: 'shadow-yellow-500/20'
        }
      case 'dramatic':
        return {
          icon: '🎭',
          label: 'Dramatic',
          bg: 'bg-pink-900/30',
          border: 'border-pink-700',
          text: 'text-pink-300',
          glow: 'shadow-pink-500/20'
        }
      case 'tense':
        return {
          icon: '⚡',
          label: 'Tense',
          bg: 'bg-orange-900/30',
          border: 'border-orange-700',
          text: 'text-orange-300',
          glow: 'shadow-orange-500/20'
        }
      case 'peaceful':
        return {
          icon: '🕊️',
          label: 'Peaceful',
          bg: 'bg-cyan-900/30',
          border: 'border-cyan-700',
          text: 'text-cyan-300',
          glow: 'shadow-cyan-500/20'
        }
    }
  }

  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-1.5',
    lg: 'text-base px-4 py-2'
  }

  const config = getMoodConfig()

  return (
    <div
      className={`
        inline-flex items-center gap-1.5
        ${config.bg} ${config.border} ${config.text}
        border rounded-full
        ${sizeClasses[size]}
        font-medium
        shadow-lg ${config.glow}
        transition-all duration-200
        hover:scale-105
      `}
    >
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </div>
  )
}

// Helper function to detect mood from scene text (can be used by AI or manually set)
export function detectSceneMood(sceneText: string): SceneMood[] {
  const text = sceneText.toLowerCase()
  const moods: SceneMood[] = []

  if (/(fight|attack|battle|combat|weapon|strike|defend)/i.test(text)) moods.push('combat')
  if (/(conversation|talk|speak|negotiate|persuade|charm)/i.test(text)) moods.push('social')
  if (/(investigate|search|examine|clue|discover|look for)/i.test(text)) moods.push('investigation')
  if (/(sneak|hide|stealth|quiet|shadow)/i.test(text)) moods.push('stealth')
  if (/(explore|journey|travel|discover|wander)/i.test(text)) moods.push('exploration')
  if (/(rest|relax|camp|sleep|downtime)/i.test(text)) moods.push('downtime')
  if (/(dramatic|intense|emotional|powerful|confrontation)/i.test(text)) moods.push('dramatic')
  if (/(tense|nervous|anxious|danger|threat)/i.test(text)) moods.push('tense')
  if (/(peaceful|calm|serene|quiet|tranquil)/i.test(text)) moods.push('peaceful')

  return moods.length > 0 ? moods : ['exploration']
}
