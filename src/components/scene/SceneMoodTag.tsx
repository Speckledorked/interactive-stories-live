// src/components/scene/SceneMoodTag.tsx
// Visual mood/tone indicators for scenes

'use client'

import { MOOD_ICONS } from '@/lib/ui/icons'

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

// Myth only has 4 semantic color slots (good/warn/danger/info) plus
// neutral ink — collapsing the old 9 distinct hues by valence rather than
// inventing new colors. Icons stay per-mood to carry the fine-grained
// distinction the shared colors lose; they live in lib/ui/icons.ts so the
// same mood reads the same everywhere.

const MOOD_LABELS: Record<SceneMood, string> = {
  combat: 'Combat',
  social: 'Social',
  investigation: 'Investigation',
  stealth: 'Stealth',
  exploration: 'Exploration',
  downtime: 'Downtime',
  dramatic: 'Dramatic',
  tense: 'Tense',
  peaceful: 'Peaceful',
}

const MOOD_VALENCE: Record<SceneMood, 'danger' | 'info' | 'good' | 'neutral'> = {
  combat: 'danger',
  tense: 'danger',
  social: 'info',
  dramatic: 'info',
  downtime: 'good',
  peaceful: 'good',
  investigation: 'neutral',
  stealth: 'neutral',
  exploration: 'neutral',
}

const VALENCE_CLASSES = {
  danger: { bg: 'bg-myth-danger/10', border: 'border-myth-danger/30', text: 'text-myth-danger' },
  info: { bg: 'bg-myth-info/10', border: 'border-myth-info/30', text: 'text-myth-info' },
  good: { bg: 'bg-myth-good/10', border: 'border-myth-good/30', text: 'text-myth-good' },
  neutral: { bg: 'bg-myth-surface-sunken', border: 'border-myth-border', text: 'text-myth-ink-muted' },
}

export default function SceneMoodTag({ mood, size = 'md' }: SceneMoodTagProps) {
  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-1.5',
    lg: 'text-base px-4 py-2'
  }

  const config = VALENCE_CLASSES[MOOD_VALENCE[mood]]
  const MoodIcon = MOOD_ICONS[mood]

  return (
    <div
      className={`
        inline-flex items-center gap-1.5
        ${config.bg} ${config.border} ${config.text}
        border rounded-full
        ${sizeClasses[size]}
        font-medium
        transition-colors
      `}
    >
      <MoodIcon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      <span>{MOOD_LABELS[mood]}</span>
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
