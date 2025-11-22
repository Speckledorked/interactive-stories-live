// src/components/scene/NPCRelationshipHints.tsx
// Subtle visual cues for NPC relationships based on behavior, not numbers

'use client'

export interface NPCRelationshipHint {
  npcName: string
  tone: 'friendly' | 'neutral' | 'wary' | 'hostile' | 'fearful' | 'respectful'
  recentInteraction?: string
  signalPhrase?: string // Subtle cue from the scene text
}

interface NPCRelationshipHintsProps {
  hints: NPCRelationshipHint[]
  sceneText?: string
}

export default function NPCRelationshipHints({
  hints,
  sceneText
}: NPCRelationshipHintsProps) {
  if (hints.length === 0) {
    return null
  }

  // Get visual representation for tone
  const getToneConfig = (tone: NPCRelationshipHint['tone']) => {
    switch (tone) {
      case 'friendly':
        return {
          icon: '😊',
          label: 'Friendly',
          color: 'text-green-400',
          bg: 'bg-green-900/20',
          border: 'border-green-700/50',
          description: 'Seems warm and welcoming'
        }
      case 'neutral':
        return {
          icon: '😐',
          label: 'Neutral',
          color: 'text-gray-400',
          bg: 'bg-gray-900/20',
          border: 'border-gray-700/50',
          description: 'Maintains professional distance'
        }
      case 'wary':
        return {
          icon: '🤨',
          label: 'Wary',
          color: 'text-yellow-400',
          bg: 'bg-yellow-900/20',
          border: 'border-yellow-700/50',
          description: 'Seems cautious around you'
        }
      case 'hostile':
        return {
          icon: '😠',
          label: 'Hostile',
          color: 'text-red-400',
          bg: 'bg-red-900/20',
          border: 'border-red-700/50',
          description: 'Clearly antagonistic'
        }
      case 'fearful':
        return {
          icon: '😰',
          label: 'Fearful',
          color: 'text-purple-400',
          bg: 'bg-purple-900/20',
          border: 'border-purple-700/50',
          description: 'Appears intimidated or afraid'
        }
      case 'respectful':
        return {
          icon: '🙏',
          label: 'Respectful',
          color: 'text-blue-400',
          bg: 'bg-blue-900/20',
          border: 'border-blue-700/50',
          description: 'Shows deference and respect'
        }
    }
  }

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        NPC Reactions
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {hints.map((hint, idx) => {
          const config = getToneConfig(hint.tone)
          return (
            <div
              key={idx}
              className={`rounded-lg border ${config.border} ${config.bg} p-3 hover:scale-[1.02] transition-transform`}
            >
              <div className="flex items-start gap-2">
                <span className="text-xl flex-shrink-0">{config.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1">
                    <h5 className="font-semibold text-white text-sm truncate">
                      {hint.npcName}
                    </h5>
                    <span className={`text-xs ${config.color}`}>
                      {config.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    {config.description}
                  </p>
                  {hint.signalPhrase && (
                    <p className="text-xs text-gray-500 italic mt-1 border-l-2 border-gray-700 pl-2">
                      "{hint.signalPhrase}"
                    </p>
                  )}
                  {hint.recentInteraction && (
                    <p className="text-xs text-gray-600 mt-1">
                      Last: {hint.recentInteraction}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Helper function to extract NPC mentions and relationship hints from scene text
 * This analyzes the narrative tone to infer relationship status
 */
export function extractNPCHintsFromScene(
  sceneText: string,
  npcs: Array<{ name: string; id: string }>
): NPCRelationshipHint[] {
  const hints: NPCRelationshipHint[] = []

  // Convert scene text to lowercase for matching
  const lowerText = sceneText.toLowerCase()

  for (const npc of npcs) {
    const npcLower = npc.name.toLowerCase()

    // Check if NPC is mentioned in the scene
    if (!lowerText.includes(npcLower)) {
      continue
    }

    // Extract the sentence/paragraph where the NPC is mentioned
    const sentences = sceneText.split(/[.!?]+/)
    const mentionSentence = sentences.find(s =>
      s.toLowerCase().includes(npcLower)
    )

    if (!mentionSentence) continue

    // Analyze the tone based on keywords and context
    let tone: NPCRelationshipHint['tone'] = 'neutral'
    let signalPhrase: string | undefined

    // Hostile indicators
    if (
      /glare|scowl|growl|snarl|threaten|anger|rage|furious|hostile|enemy|attack/i.test(mentionSentence) ||
      new RegExp(`${npcLower}.*(?:glares?|scowls?|snarls?)`, 'i').test(mentionSentence)
    ) {
      tone = 'hostile'
      const match = mentionSentence.match(/([^.]*(?:glare|scowl|growl|snarl|threaten)[^.]*)/i)
      signalPhrase = match?.[1]?.trim()
    }
    // Fearful indicators
    else if (
      /cower|tremble|fear|afraid|terrified|shrink|back away|intimidated/i.test(mentionSentence) ||
      new RegExp(`${npcLower}.*(?:cowers?|trembles?|backs? away)`, 'i').test(mentionSentence)
    ) {
      tone = 'fearful'
      const match = mentionSentence.match(/([^.]*(?:cower|tremble|fear|afraid)[^.]*)/i)
      signalPhrase = match?.[1]?.trim()
    }
    // Friendly indicators
    else if (
      /smile|grin|warmth|friendly|welcome|embrace|laugh|pleased|happy|glad|friend/i.test(mentionSentence) ||
      new RegExp(`${npcLower}.*(?:smiles?|grins?|laughs?|nods? warmly)`, 'i').test(mentionSentence)
    ) {
      tone = 'friendly'
      const match = mentionSentence.match(/([^.]*(?:smile|grin|warmth|friendly|welcome)[^.]*)/i)
      signalPhrase = match?.[1]?.trim()
    }
    // Respectful indicators
    else if (
      /bow|kneel|respect|honor|defer|reverence|admire|esteem/i.test(mentionSentence) ||
      new RegExp(`${npcLower}.*(?:bows?|kneels?|shows? respect)`, 'i').test(mentionSentence)
    ) {
      tone = 'respectful'
      const match = mentionSentence.match(/([^.]*(?:bow|respect|honor|defer)[^.]*)/i)
      signalPhrase = match?.[1]?.trim()
    }
    // Wary indicators
    else if (
      /cautious|wary|suspicious|hesitant|uncertain|careful|guarded/i.test(mentionSentence) ||
      new RegExp(`${npcLower}.*(?:eyes? you|watches? carefully|seems? cautious)`, 'i').test(mentionSentence)
    ) {
      tone = 'wary'
      const match = mentionSentence.match(/([^.]*(?:cautious|wary|suspicious|hesitant)[^.]*)/i)
      signalPhrase = match?.[1]?.trim()
    }

    hints.push({
      npcName: npc.name,
      tone,
      signalPhrase: signalPhrase?.substring(0, 80) // Limit length
    })
  }

  return hints
}
