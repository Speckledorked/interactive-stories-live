// src/lib/wiki/contactNpcStubs.ts
// Auto-creates a stub WikiEntry (entryType 'NPC') for each named contact on
// a character's sheet that doesn't already have one — so a backstory
// mention of someone the party hasn't met yet still gets a wiki page to
// grow into. Shared by character creation (every contact) and character
// update (only newly-added contacts) in campaigns/[id]/characters/route.ts
// and campaigns/[id]/characters/[characterId]/route.ts, which were
// carrying an identical copy of this loop each.

import { prisma } from '@/lib/prisma'

export async function ensureContactNpcStubs(
  campaignId: string,
  characterName: string,
  contactNames: string[]
): Promise<void> {
  for (const contactName of contactNames) {
    try {
      // Check if NPC already exists with this name or alias
      const existingNPC = await prisma.wikiEntry.findFirst({
        where: {
          campaignId,
          entryType: 'NPC',
          OR: [
            { name: contactName },
            { aliases: { has: contactName } }
          ]
        }
      })

      if (!existingNPC) {
        // Create stub NPC entry
        await prisma.wikiEntry.create({
          data: {
            campaignId,
            entryType: 'NPC',
            name: contactName,
            summary: `Contact of ${characterName}`,
            description: `${contactName} is a known contact of ${characterName}. More details will be revealed through gameplay.`,
            tags: ['contact', 'unmet'],
            aliases: [],
            importance: 'normal',
            createdBy: 'system'
          }
        })
        console.log(`✨ Auto-created NPC: ${contactName} (contact of ${characterName})`)
      }
    } catch (npcError) {
      // Log error but don't fail character creation/update
      console.error(`Failed to auto-create NPC for contact ${contactName}:`, npcError)
    }
  }
}
