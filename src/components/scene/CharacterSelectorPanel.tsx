// src/components/scene/CharacterSelectorPanel.tsx
// The story page sidebar's character picker + quick-glance card. Split out
// of story/page.tsx's ~1700-line body, which already read as several
// self-contained sidebar panels separated only by comments — this is one
// of them, moved verbatim (same markup, same classes, same conditions).

'use client'

interface CharacterSelectorPanelProps {
  userCharacters: any[]
  selectedCharacterId: string
  onSelectCharacter: (characterId: string) => void
  selectedCharacter: any
  onShowSnapshot: () => void
}

export function CharacterSelectorPanel({
  userCharacters,
  selectedCharacterId,
  onSelectCharacter,
  selectedCharacter,
  onShowSnapshot,
}: CharacterSelectorPanelProps) {
  if (userCharacters.length === 0) return null

  return (
    <div className="rounded-xl bg-gradient-to-br from-tavern-800/70 to-tavern-900/70 border border-ember-900/30 shadow-lg shadow-black/30 p-5">
      <h3 className="text-sm font-bold text-ember-300/60 mb-3">SELECT CHARACTER</h3>
      <select
        value={selectedCharacterId}
        onChange={(e) => onSelectCharacter(e.target.value)}
        className="px-4 py-2.5 rounded-lg bg-black/30 border border-ember-900/40 text-ember-100 placeholder:text-ember-500/30 focus:outline-none focus:border-ember-600/60 w-full"
      >
        <option value="">Choose a character...</option>
        {userCharacters.map(char => (
          <option key={char.id} value={char.id}>
            {char.name}
          </option>
        ))}
      </select>
      {selectedCharacter && (
        <div className="mt-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <h4 className="font-bold text-ember-100 text-lg">{selectedCharacter.name}</h4>
              <p className="text-sm text-ember-300/60">{selectedCharacter.concept}</p>
            </div>
            <button
              onClick={onShowSnapshot}
              className="px-2 py-1 bg-wine-600 hover:bg-wine-500 text-ember-100 rounded text-xs font-medium transition-colors"
              title="Quick Reference"
            >
              👁️ View
            </button>
          </div>
          {selectedCharacter.currentLocation && (
            <p className="text-xs text-ember-400/50">
              📍 {selectedCharacter.currentLocation}
            </p>
          )}
          {Array.isArray(selectedCharacter.conditions) &&
            selectedCharacter.conditions.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-ember-400/50 mb-1">Conditions:</p>
                <div className="flex flex-wrap gap-1">
                  {selectedCharacter.conditions.map((cond: string, i: number) => (
                    <span
                      key={i}
                      className="px-2 py-1 bg-wine-800/30 text-wine-400 rounded text-xs"
                    >
                      {cond}
                    </span>
                  ))}
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  )
}
