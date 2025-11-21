# Phase 7 Implementation Guide - PbtA Dice System

## Overview
Phase 7 adds Powered by the Apocalypse (PbtA) mechanics to your AI GM app, focusing on narrative-first gameplay with meaningful dice rolls and consequences.

## New Features

### 🎲 PbtA Dice System
- 2d6 + stat rolls with three outcomes (10+, 7-9, 6-)
- Basic moves from Apocalypse World
- Custom move creation for your campaign
- Roll history and live notifications

### ⚔️ Turn Order & Initiative
- Combat/action sequence management
- Initiative based on Cool stat
- Round tracking
- Visual turn indicators

### 📖 Moves Reference
- Built-in basic moves (Act Under Fire, Go Aggro, etc.)
- Custom move creation for admins
- Quick reference during play
- Integrated with dice roller

### 🎭 Character Stats (PbtA Style)
- Five core stats: Cool, Hard, Hot, Sharp, Weird
- Range from -1 to +2
- Harm tracking (0-6)
- Experience system
- Conditions system

### 🤖 AI GM Integration
- Understands roll outcomes
- Applies PbtA principles (fail forward, partial success)
- Makes appropriate hard/soft moves
- Respects the fiction

## Files to Add/Update

### 1. Database Schema
**Replace:** `prisma/schema.prisma`
- Adds DiceRoll, Move, and TurnOrder models
- Updates Character with PbtA fields
- Adds harm, XP, and conditions tracking

### 2. Core Libraries
**Add:**
- `src/lib/pbta-moves.ts` - Move definitions and mechanics
- `src/lib/ai-gm-pbta.ts` - AI GM PbtA integration

### 3. API Routes
**Add:**
- `src/app/api/campaigns/[id]/rolls/route.ts` - Dice rolling
- `src/app/api/campaigns/[id]/moves/route.ts` - Move management
- `src/app/api/campaigns/[id]/scenes/[sceneId]/turn-order/route.ts` - Turn order

### 4. Components
**Add:**
- `src/components/DiceRoller.tsx` - Dice rolling UI
- `src/components/TurnOrder.tsx` - Turn order display
- `src/components/MovesReference.tsx` - Moves quick reference

**Update:**
- `src/components/CreateCharacterForm.tsx` - PbtA stats

### 5. Pages
**Update:**
- `src/app/campaigns/[id]/story/page.tsx` - Integrate all PbtA features

## Installation Steps

### 1. Backup Your Project
```bash
git add .
git commit -m "Before Phase 7"
```

### 2. Place Files
Extract all files to their respective locations in your project structure.

### 3. Run Database Migration
```bash
npx prisma migrate dev --name add_pbta_features
```

### 4. Update Dependencies
No new dependencies needed - uses existing Pusher for realtime updates.

### 5. Initialize Basic Moves (Admin Only)
After deployment, admins can click "Initialize PbtA Moves" to add basic moves.

## Testing Phase 7 Features

### Character Creation with PbtA Stats
1. Create a new character
2. Allocate 3 stat points (range: -1 to +2)
3. Note the PbtA stat descriptions

### Rolling Dice
1. In a scene, click "🎲 Roll Dice"
2. Select a move or custom roll
3. Choose stat modifier
4. Roll and see outcome (10+, 7-9, 6-)
5. Watch for realtime notifications

### Using Moves
1. Click "📖 Moves" to see reference
2. Click any move for full details
3. Admins can create custom moves
4. Moves integrate with dice roller

### Turn Order (Combat)
1. Admin starts combat with "Start Combat"
2. Initiative rolled automatically (2d6 + Cool)
3. Players see when it's their turn
4. "End My Turn" button when active
5. Admin controls flow with "Next Turn"

### AI GM Integration
1. Roll dice before submitting action
2. AI GM sees roll result
3. Response incorporates outcome appropriately:
   - 10+: Clean success
   - 7-9: Success with complication
   - 6-: Hard move/consequence

## PbtA Principles for Your Table

### Fiction First
The story drives everything. Rolls happen when the fiction demands it.

### Fail Forward
Misses (6-) don't stop the story - they complicate it dramatically.

### Partial Success
7-9 means "yes, but..." - success with a cost, complication, or hard choice.

### Play to Find Out
Even the GM doesn't know what will happen. The dice and choices reveal the story.

## Customization Options

### Custom Moves
Admins can create moves specific to your campaign:
- Unique triggers for your world
- Custom stat combinations
- Setting-specific outcomes

### Adjusting Stats
You can rename stats in `lib/pbta-moves.ts`:
- Cool → Steady
- Hard → Force  
- Hot → Charm
- Sharp → Insight
- Weird → Magic

### Harm Variants
Default is 0-6 harm. You can adjust:
- Clock-based harm (4 segments)
- Stress/Trauma instead of harm
- Multiple tracks (physical/mental)

## Troubleshooting

### Rolls Not Appearing?
- Check Pusher connection
- Verify character is selected
- Ensure scene is active

### Turn Order Not Working?
- Must be admin to initialize
- Scene must be active
- All characters need stats

### AI Not Recognizing Rolls?
- Ensure AI prompt includes PbtA context
- Roll must be made before action
- Check if roll is linked to action

## Next Steps

After Phase 7 is working:
1. Initialize basic moves
2. Create campaign-specific custom moves
3. Teach players the basic moves
4. Let fiction trigger mechanics naturally
5. Use "Play to find out" philosophy

## PbtA Quick Reference for Players

### When to Roll?
- When you trigger a move's condition
- When outcome is uncertain and interesting
- Not for every action - fiction first!

### Basic Moves Everyone Can Use:
- **Act Under Fire** - Do something despite danger
- **Go Aggro** - Use violence or threats
- **Seduce/Manipulate** - Convince someone
- **Read a Situation** - Assess what's happening
- **Read a Person** - Understand someone
- **Open Your Brain** - Tap into weirdness
- **Help/Interfere** - Affect another's roll

### Reading Results:
- **10+ Strong Hit** - You do it!
- **7-9 Weak Hit** - Yes, but...
- **6- Miss** - Things go wrong!

Remember: Every roll changes the situation!