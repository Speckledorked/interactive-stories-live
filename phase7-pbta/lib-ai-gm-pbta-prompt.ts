// src/lib/ai-gm-pbta-prompt.ts
// Updated AI GM system prompt incorporating PbtA mechanics

export const PBTA_AI_GM_PROMPT = `You are an AI Game Master running a Powered by the Apocalypse (PbtA) style game. Your role is to:

1. FRAME SCENES with evocative descriptions that demand action
2. INTERPRET DICE ROLLS narratively based on PbtA outcomes:
   - Strong Hit (10+): Full success, player gets what they want
   - Weak Hit (7-9): Success with complication, cost, or hard choice
   - Miss (6-): Things go wrong, make a hard move

3. FOLLOW THE PRINCIPLES:
   - Be a fan of the characters
   - Make the world seem real
   - Play to find out what happens
   - Address the characters, not the players
   - Make your moves, but never speak their names
   - Name everyone, make everyone human
   - Ask questions and build on the answers
   - Be honest about the risks
   - Think offscreen too

4. MAKE GM MOVES when:
   - A player misses a roll (6-)
   - A player gives you a golden opportunity
   - When the players look at you expectantly

5. YOUR GM MOVES:
   - Separate them
   - Capture someone
   - Put someone in a spot
   - Trade harm for harm
   - Announce future badness
   - Announce offscreen badness
   - Inflict harm
   - Take away their stuff
   - Turn their move back on them
   - Tell them the possible consequences and ask
   - Offer an opportunity with or without cost
   - Activate their stuff's downside

6. RESOLVE PLAYER ACTIONS:
   - When a player triggers a move, acknowledge it
   - Apply the roll results narratively
   - On weak hits, introduce complications
   - On misses, make hard moves that follow from the fiction
   - Always push the action forward

7. MANAGE HARM AND CONDITIONS:
   - 1-2 harm: Painful but manageable
   - 3-4 harm: Serious injuries, might need help
   - 5-6 harm: Life-threatening, immediate action needed
   - Apply conditions that affect the story

8. ADVANCE THE WORLD:
   - NPCs have their own goals and act on them
   - Factions make moves offscreen
   - Clocks tick forward based on events
   - The world doesn't wait for the players

Remember: The conversation is the game. Keep it flowing, keep it dangerous, keep it interesting. When in doubt, make things worse in interesting ways.

CURRENT MOVE CONTEXT:
When a player's action has an associated dice roll, reference the specific move outcomes provided. Apply them creatively based on the fiction.`

export const generateScenePrompt = (worldState: any, previousScene: any) => {
  return `Based on the current world state and previous events, frame a new scene that:
  
  1. Starts in media res - drop the characters into action
  2. Has clear stakes - what's at risk?
  3. Demands a response - what must be dealt with NOW?
  4. Connects to ongoing threats or opportunities
  5. Gives each character something to care about
  
  World State Summary:
  ${JSON.stringify(worldState, null, 2)}
  
  Previous Scene:
  ${previousScene ? JSON.stringify(previousScene, null, 2) : 'This is the opening scene'}
  
  Frame the scene with:
  - A vivid description of the location and atmosphere
  - The immediate situation requiring action
  - Who is present and what they're doing
  - What just happened or is about to happen
  - Clear stakes (what happens if they fail?)
  
  Keep it punchy and evocative. Maximum 3 paragraphs.`
}

export const generateActionResolution = (
  action: any,
  roll: any,
  move: any,
  worldState: any
) => {
  const outcomeType = roll ? roll.outcome : 'noRoll'
  
  return `Resolve this player action based on the roll result:
  
  ACTION: ${action.actionText}
  CHARACTER: ${action.character.name}
  
  ${roll ? `
  ROLL RESULT: ${roll.total} (${roll.outcome})
  DICE: [${roll.dice.join(', ')}] + ${roll.modifier}
  MOVE: ${move?.name || 'Custom'}
  ` : 'NO ROLL REQUIRED'}
  
  ${move ? `
  MOVE OUTCOMES:
  - Strong Hit (10+): ${move.outcomes.strongHit}
  - Weak Hit (7-9): ${move.outcomes.weakHit}  
  - Miss (6-): ${move.outcomes.miss}
  ` : ''}
  
  RESOLUTION GUIDELINES:
  ${outcomeType === 'strongHit' ? 
    '- Give them what they want\n- They succeed cleanly\n- Maybe give them a little extra' :
    outcomeType === 'weakHit' ?
    '- Success with complication\n- Offer a hard bargain\n- Put them in a spot\n- Give them what they want but with strings attached' :
    outcomeType === 'miss' ?
    '- Make a hard GM move\n- Turn their move back on them\n- Separate them, put them in danger\n- Advance a threat' :
    '- Judge based on the fiction\n- Can they just do it?\n- Or does it trigger a move?'}
  
  Write a brief, evocative resolution that:
  1. Honors the dice result
  2. Moves the story forward
  3. Creates new opportunities or complications
  4. Stays true to the established fiction
  
  Keep it to 2-3 punchy paragraphs maximum.`
}

export const generateWorldTurn = (worldState: any, recentEvents: any[]) => {
  return `Based on recent events, advance the world state:
  
  RECENT EVENTS:
  ${recentEvents.map(e => `- ${e.summary}`).join('\n')}
  
  CURRENT THREATS:
  ${worldState.threats?.map((t: any) => `- ${t.name}: ${t.currentPlan}`).join('\n') || 'None defined'}
  
  ACTIVE CLOCKS:
  ${worldState.clocks?.map((c: any) => `- ${c.name}: ${c.filled}/${c.segments}`).join('\n') || 'None active'}
  
  ADVANCE THE WORLD BY:
  1. Having NPCs act on their goals
  2. Advancing threat clocks based on logic
  3. Introducing consequences of previous actions
  4. Creating new opportunities or dangers
  5. Showing how the world changes
  
  Describe 2-3 things that happen offscreen that will affect the characters soon.
  Keep each to 1-2 sentences.`
}