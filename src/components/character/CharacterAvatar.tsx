// src/components/character/CharacterAvatar.tsx
// Character avatar component with initials and color

'use client'

interface CharacterAvatarProps {
  name: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

export default function CharacterAvatar({ name, size = 'md', className = '' }: CharacterAvatarProps) {
  // Get initials from name
  const getInitials = (name: string): string => {
    const words = name.trim().split(/\s+/)
    if (words.length === 1) {
      return words[0].substring(0, 2).toUpperCase()
    }
    return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  }

  // Generate consistent color from name
  const getColorFromName = (name: string): string => {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }

    const colors = [
      'from-ember-500 to-ember-600',
      'from-wine-500 to-wine-700',
      'from-amber-500 to-amber-600',
      'from-emerald-600 to-emerald-700',
      'from-orange-600 to-orange-700',
      'from-rose-600 to-rose-700',
      'from-yellow-600 to-yellow-700',
      'from-slate-500 to-slate-600',
    ]

    return colors[Math.abs(hash) % colors.length]
  }

  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-12 h-12 text-sm',
    lg: 'w-16 h-16 text-lg',
    xl: 'w-24 h-24 text-2xl'
  }

  const initials = getInitials(name)
  const gradientColor = getColorFromName(name)

  return (
    <div
      className={`
        ${sizeClasses[size]}
        rounded-full
        bg-gradient-to-br ${gradientColor}
        flex items-center justify-center
        font-bold text-white
        shadow-lg
        ring-2 ring-ember-900/40
        ${className}
      `}
    >
      {initials}
    </div>
  )
}
