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
      'from-blue-500 to-blue-600',
      'from-purple-500 to-purple-600',
      'from-pink-500 to-pink-600',
      'from-red-500 to-red-600',
      'from-orange-500 to-orange-600',
      'from-yellow-500 to-yellow-600',
      'from-green-500 to-green-600',
      'from-teal-500 to-teal-600',
      'from-cyan-500 to-cyan-600',
      'from-indigo-500 to-indigo-600',
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
        ring-2 ring-gray-700
        ${className}
      `}
    >
      {initials}
    </div>
  )
}
