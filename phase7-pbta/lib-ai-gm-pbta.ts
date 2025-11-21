// src/lib/ai-gm-pbta.ts
// Updated AI GM integration for Phase 7 with PbtA mechanics

import { prisma } from '@/lib/prisma'
import { calculateOutcome } from '@/lib/pbta-moves'

interface PbtAContext {
  lastRoll?: {
    total: number
    outcome: 'strongHit' | 'weakHit' | 'miss'
    move?: string
    description?: string
  }
  characterConditions?: string[]
  sceneStakes?: string
  threatLevel?: number
}

export async function enhanceAIPromptWithPbtA(
  basePrompt: string,
  campaignId: string,
  sceneId?: string
): Promise<string> {
  let pbtaContext: PbtAContext = {}

  // Get recent rolls if in a scene
  if (sceneId) {
    const recentRoll = await prisma.diceRoll.findFirst({
      where: {
        sceneId,
        campaignId,
      },
      orderBy: {
        createdAt: 'desc'
      },
      include: {
        move: true,
        character: true,
      }
    })

    if (recentRoll) {
      pbtaContext.lastRoll = {
        total: recentRoll.total,
        outcome: recentRoll.outcome as 'strongHit' | 'weakHit' | 'miss',
        move: recentRoll.move?.name,
        description: recentRoll.description || undefined,
      }
    }

    // Get scene stakes
    const scene = await prisma.scene.findUnique({
      where: { id: sceneId }
    })
    if (scene && typeof scene === 'object' && 'stakes' in scene) {
      pbtaContext.sceneStakes = scene.stakes as string
    }
  }

  // Get overall threat level from clocks
  const threateningClocks = await prisma.clock.count({
    where: {
      campaignId,
      category: 'threat',
      filled: {
        gte: prisma.clock.fields.segments
      }
    }
  })
  pbtaContext.threatLevel = threateningClocks

  // Build enhanced prompt
  const enhancedPrompt = `
${basePrompt}

## PbtA System Rules

You are running a Powered by the Apocalypse (PbtA) style game. Key principles:

1. **Fiction First**: The narrative drives everything. Mechanics support the story.
2. **Fail Forward**: Misses (6-) create complications, not dead ends.
3. **Partial Success**: On 7-9, give them what they want but at a cost.
4. **Make Moves**: When players trigger moves, respect the outcomes.

### Roll Outcomes:
- **10+ (Strong Hit)**: They do it, clean success
- **7-9 (Weak Hit)**: Success with complication, cost, or hard choice  
- **6- (Miss)**: Make a hard move - separate them, put them in a spot, inflict harm, etc.

${pbtaContext.lastRoll ? `
### Most Recent Roll:
- Total: ${pbtaContext.lastRoll.total} (${pbtaContext.lastRoll.outcome})
- Move: ${pbtaContext.lastRoll.move || 'Custom'}
- Intent: ${pbtaContext.lastRoll.description || 'Not specified'}

IMPORTANT: Incorporate this roll's outcome into your response. 
- Strong Hit: Give them what they want clearly
- Weak Hit: Success but with a complication or hard bargain
- Miss: Make a hard move against them
` : ''}

${pbtaContext.sceneStakes ? `
### Current Scene Stakes:
${pbtaContext.sceneStakes}
Keep these stakes in mind when framing consequences.
` : ''}

${pbtaContext.threatLevel && pbtaContext.threatLevel > 0 ? `
### Threat Level:
${pbtaContext.threatLevel} threat clock(s) have filled. The situation should feel increasingly dangerous.
` : ''}

### Your Agenda as GM:
- Make the world seem real
- Make the characters' lives interesting  
- Play to find out what happens

### Your Principles:
- Address the characters, not the players
- Make your move, but misdirect
- Never speak the name of your move
- Give every NPC a simple motivation
- Be a fan of the characters
- Think dangerous
- Begin and end with the fiction

### Hard Moves (use on misses):
- Separate them
- Put them in a spot
- Inflict harm (1-3 harm based on threat)
- Take away their stuff
- Activate their stuff's downside
- Tell them the possible consequences and ask
- Turn their move back on them
- Make a threat move from an NPC or faction

Remember: Every roll should change the situation. No roll should be wasted.
`

  return enhancedPrompt
}

// Helper to process player actions with PbtA context
export async function processActionWithRoll(
  actionId: string,
  rollId?: string
): Promise<{
  shouldResolve: boolean
  context: string
}> {
  const action = await prisma.playerAction.findUnique({
    where: { id: actionId },
    include: {
      character: true,
      scene: true,
    }
  })

  if (!action) {
    return { shouldResolve: false, context: '' }
  }

  let context = `
Character: ${action.character.name}
Action: ${action.actionText}
Intent: ${action.intentOutcome || 'Not specified'}
`

  if (rollId) {
    const roll = await prisma.diceRoll.findUnique({
      where: { id: rollId },
      include: { move: true }
    })

    if (roll) {
      context += `
Roll Result: ${roll.total} (${roll.outcome})
Move: ${roll.move?.name || 'Custom roll'}
`
      
      // Add specific guidance based on outcome
      if (roll.outcome === 'miss') {
        context += `
GM Guidance: This is a MISS. Make a hard move. Consider:
- Putting them in immediate danger
- Separating them from allies
- Inflicting 1-3 harm
- Revealing an unwelcome truth
- Advancing a threat clock
`
      } else if (roll.outcome === 'weakHit') {
        context += `
GM Guidance: This is a WEAK HIT (7-9). Give them success but:
- At a cost (resources, time, position)
- With a hard bargain ("you can do it if...")  
- With an ugly choice (save one, lose another)
- With reduced effect
`
      } else {
        context += `
GM Guidance: This is a STRONG HIT (10+). They succeed cleanly.
- Give them what they wanted
- Let them be awesome
- Build on their success
`
      }
    }
  }

  return {
    shouldResolve: true,
    context
  }
}

// Generate PbtA-specific scene frames
export function generatePbtASceneFrame(sceneType: 'dramatic' | 'downtime' | 'combat'): string {
  const frames: Record<typeof sceneType, string> = {
    dramatic: `Frame this as a tense, character-driven scene. Focus on:
- Interpersonal conflict or hard choices
- Stakes that matter to the characters personally
- Opportunities for multiple moves (Read a Person, Manipulate, etc.)`,
    
    downtime: `Frame this as a quieter moment. Include:
- Opportunities to heal or recover
- Character development and relationships  
- Preparation for what's coming
- Let them trigger beginning-of-session moves`,
    
    combat: `Frame this as action and danger. Establish:
- Clear threats and opposition
- Environmental hazards or complications
- What's at stake beyond just winning
- Opportunities for Go Aggro, Act Under Fire, and Seize by Force`
  }

  return frames[sceneType]
}