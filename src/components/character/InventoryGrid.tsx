// src/components/character/InventoryGrid.tsx
// Visual inventory grid display

'use client'

interface InventoryItem {
  id: string
  name: string
  quantity: number
  tags: string[]
}

interface InventoryGridProps {
  items: InventoryItem[]
  maxSlots: number
}

export default function InventoryGrid({ items, maxSlots }: InventoryGridProps) {
  const totalSlots = Array.from({ length: maxSlots }, (_, i) => i)

  const getItemIcon = (tags: string[]): string => {
    if (tags.includes('weapon')) return '⚔️'
    if (tags.includes('armor')) return '🛡️'
    if (tags.includes('potion')) return '🧪'
    if (tags.includes('food')) return '🍖'
    if (tags.includes('quest')) return '📜'
    if (tags.includes('important')) return '⭐'
    if (tags.includes('magical')) return '✨'
    if (tags.includes('tool')) return '🔧'
    return '📦'
  }

  const getItemRarity = (tags: string[]): string => {
    if (tags.includes('legendary')) return 'from-yellow-500 to-orange-500'
    if (tags.includes('rare')) return 'from-purple-500 to-blue-500'
    if (tags.includes('uncommon')) return 'from-green-500 to-teal-500'
    return 'from-gray-600 to-gray-700'
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-2">
        {totalSlots.map((slotIndex) => {
          const item = items[slotIndex]

          if (!item) {
            // Empty slot
            return (
              <div
                key={slotIndex}
                className="
                  aspect-square
                  rounded-lg
                  border-2 border-dashed border-gray-700
                  bg-gray-900/50
                  flex items-center justify-center
                  text-gray-700
                "
              >
                <span className="text-2xl">⋯</span>
              </div>
            )
          }

          const icon = getItemIcon(item.tags)
          const rarity = getItemRarity(item.tags)

          return (
            <div
              key={item.id}
              className="
                aspect-square
                rounded-lg
                border-2 border-gray-700
                bg-gradient-to-br
                from-gray-800 to-gray-900
                p-2
                flex flex-col items-center justify-center
                relative
                group
                hover:border-primary-500
                hover:shadow-lg
                hover:scale-105
                transition-all duration-200
                cursor-pointer
              "
              title={item.name}
            >
              {/* Item icon */}
              <div className="text-2xl mb-1">
                {icon}
              </div>

              {/* Quantity badge */}
              {item.quantity > 1 && (
                <div className="
                  absolute top-1 right-1
                  bg-gray-900/90 border border-gray-600
                  rounded-full
                  w-5 h-5
                  flex items-center justify-center
                  text-xs font-bold text-white
                ">
                  {item.quantity > 99 ? '99+' : item.quantity}
                </div>
              )}

              {/* Rarity indicator */}
              <div className={`
                absolute bottom-1 left-1 right-1
                h-1 rounded-full
                bg-gradient-to-r ${rarity}
              `} />

              {/* Tooltip */}
              <div className="
                absolute -top-12 left-1/2 -translate-x-1/2
                bg-gray-900 border border-gray-700
                rounded px-2 py-1
                text-xs text-white whitespace-nowrap
                opacity-0 group-hover:opacity-100
                transition-opacity duration-200
                pointer-events-none
                z-10
                shadow-lg
              ">
                {item.name}
                {item.quantity > 1 && ` (x${item.quantity})`}
              </div>
            </div>
          )
        })}
      </div>

      {/* Item list (for overflow) */}
      {items.length > maxSlots && (
        <div className="border-t border-gray-700 pt-4">
          <p className="text-sm text-gray-400 mb-2">Additional Items (no space):</p>
          <div className="space-y-1">
            {items.slice(maxSlots).map((item) => (
              <div
                key={item.id}
                className="text-sm text-gray-300 bg-gray-800 border border-gray-700 rounded px-2 py-1"
              >
                {getItemIcon(item.tags)} {item.name}
                {item.quantity > 1 && ` (x${item.quantity})`}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
