# 🤖 Phase 10.5: AI Visual Generation - Setup Guide

## 🎯 What You're Adding

Phase 10.5 transforms your AI GM into a **fully automated visual storyteller** that creates maps, places characters, and updates scenes automatically based on the story progression.

### 🚀 Key Features

- **🤖 Automatic Map Generation**: AI analyzes scene descriptions and creates appropriate maps
- **🎭 Smart Character Placement**: AI automatically places and moves character tokens based on actions  
- **🗺️ Dynamic Scene Transitions**: Maps update automatically when the story moves to new locations
- **⚡ Interactive Zones**: AI creates clickable areas for important scene elements
- **🎨 Atmospheric Visuals**: AI matches map colors and mood to scene atmosphere
- **🔄 Real-time Updates**: All visual changes broadcast instantly to players

## 📋 Prerequisites

Before starting Phase 10.5, ensure you have:
- ✅ **Phase 9** (Notifications) fully working
- ✅ **Phase 10** basic files installed (maps, zones, tokens database models)
- ✅ **OpenAI API key** configured and working
- ✅ **Pusher** real-time notifications working

## 🚀 Installation Steps

### Step 1: Install Phase 10.5 Dependencies

No new NPM packages required! Phase 10.5 uses your existing OpenAI integration.

### Step 2: Add Environment Variables

Add these to your `.env.local` file:

```env
# AI Visual Generation
AI_VISUAL_ENABLED=true
AI_VISUAL_MODEL=gpt-4
AI_VISUAL_TEMPERATURE=0.3
AI_VISUAL_MAX_TOKENS=800

# Automatic Features
AUTO_MAP_GENERATION=true
AUTO_TOKEN_PLACEMENT=true
AUTO_ZONE_CREATION=true
MAP_TRANSITION_DETECTION=true

# Performance
VISUAL_UPDATE_DEBOUNCE=1000
MAX_CONCURRENT_VISUALS=3
VISUAL_CACHE_DURATION=3600

# Debug (optional)
AI_VISUAL_DEBUG=false
VISUAL_FALLBACK_MODE=true
```

### Step 3: Install Phase 10.5 Files

Place these files in your project:

#### Core AI Services
- `lib-ai-visual-service.ts` → `src/lib/ai/ai-visual-service.ts`
- `lib-ai-scene-visual-integration.ts` → `src/lib/ai/ai-scene-visual-integration.ts`
- `lib-ai-scene-resolution-hook.ts` → `src/lib/ai/scene-resolution-hook.ts`

#### Player-Focused Components  
- `components-maps-PlayerMapViewer.tsx` → `src/components/maps/PlayerMapViewer.tsx`
- `components-images-AIImageLibrary.tsx` → `src/components/images/AIImageLibrary.tsx`

#### API Routes
- `api-campaigns-id-scenes-sceneId-resolve-visual-route.ts` → `src/app/api/campaigns/[id]/scenes/[sceneId]/resolve-visual/route.ts`

### Step 4: Integrate with Your Existing Scene Resolution

**Option A: Replace Your Current Scene API (Recommended)**

Update your existing scene resolution API to use AI visuals:

```typescript
// In your existing scene resolution API route
import { useAIVisuals } from '@/lib/ai/scene-resolution-hook'

export async function POST(request: NextRequest) {
  const { sceneId, playerActions, campaignId } = await request.json()
  
  // This automatically generates visuals + resolves scene
  const result = await useAIVisuals(sceneId, playerActions, campaignId)
  
  return NextResponse.json(result)
}
```

**Option B: Keep Existing API + Add New Visual Endpoint**

Keep your current scene resolution and add the new visual endpoint alongside it.

### Step 5: Update Your Scene Components

**For Players - Use the New PlayerMapViewer:**

```tsx
// In your campaign/game page for players
import { PlayerMapViewer } from '@/components/maps/PlayerMapViewer'
import { AIImageLibrary } from '@/components/images/AIImageLibrary'

export default function GamePage({ campaign, character }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        {/* Your existing scene text, actions, etc. */}
      </div>
      
      <div className="space-y-4">
        {/* AI-generated map view */}
        <PlayerMapViewer 
          map={activeMap}
          characterName={character.name}
          onZoneInteract={handleZoneClick}
        />
        
        {/* AI image library */}
        <AIImageLibrary 
          images={campaignImages}
          onSearch={handleImageSearch}
        />
      </div>
    </div>
  )
}
```

**For GMs - Optional Manual Controls:**

```tsx
// In your GM panel (optional - AI handles most things automatically)
import { MapManager } from '@/components/maps/MapManager'

// GMs can still manually override AI if needed
<MapManager 
  maps={maps}
  activeMapId={activeMapId}
  campaignId={campaignId}
  onCreateMap={handleCreateMap}
  // ... other props
/>
```

### Step 6: Test the AI Visual Generation

1. **Start your application**:
```bash
npm run dev
```

2. **Test automatic visual generation**:
   - Create a new scene or continue an existing one
   - Have players submit actions
   - Watch as the AI automatically:
     - Generates a map based on the scene description
     - Places character tokens
     - Creates interactive zones
     - Updates visuals in real-time

3. **Test different scene types**:
   - **Tavern scene**: Should generate tavern layout with bar, tables
   - **Forest encounter**: Should create forest map with trees, clearings
   - **Dungeon exploration**: Should generate corridors, chambers, doors

## 🎮 How It Works for Players

### Automatic Visual Experience

1. **Scene Begins**: AI analyzes the scene description and generates an appropriate map
2. **Character Placement**: Player's character token appears automatically on the map
3. **Story Progression**: As players take actions, the AI updates their positions
4. **Scene Changes**: When the story moves to a new location, a new map generates automatically
5. **Interactive Elements**: Players can click on zones to interact with scene objects

### What Players See

- **🗺️ Live Map**: Always-current visual representation of their location
- **👥 Character Tokens**: See where they and other characters are positioned  
- **⚡ Interactive Areas**: Click zones to examine objects, doors, NPCs
- **🎨 Atmosphere**: Map colors and mood match the scene description
- **📱 Mobile Friendly**: Touch controls work on phones and tablets

## 🤖 How It Works for the AI GM

### Automatic Map Generation Process

1. **Scene Analysis**: AI analyzes scene description for:
   - Location type (tavern, forest, dungeon, etc.)
   - Important objects and areas
   - NPCs and characters present
   - Atmosphere and mood

2. **Map Creation**: AI automatically:
   - Selects appropriate map template
   - Sets dimensions and grid size
   - Chooses background colors/style

3. **Element Placement**: AI adds:
   - **Zones** for interactive areas (doors, treasure, altars)
   - **Tokens** for characters and NPCs
   - **Visual indicators** for important scene elements

4. **Real-time Updates**: As story progresses, AI:
   - Moves character tokens based on actions
   - Adds/removes NPCs as they enter/leave
   - Creates new maps for location changes

### AI Decision Making

The AI GM automatically handles:

- **Map Type Selection**: Chooses tavern/forest/dungeon/castle based on scene description
- **Zone Creation**: Creates interactive areas for mentioned objects/locations
- **Character Positioning**: Places tokens based on narrative context
- **Atmosphere Matching**: Adjusts colors and mood to match story tone
- **Transition Detection**: Knows when to create new maps vs update current one

## 🎨 Customization Options

### Visual Styles

Edit `AIVisualService.BACKGROUND_TEMPLATES` to customize:

```typescript
'tavern': { width: 800, height: 600, gridSize: 40, color: '#8B4513' },
'forest': { width: 1200, height: 900, gridSize: 60, color: '#228B22' },
// Add your own templates
```

### AI Behavior

Adjust in environment variables:
- `AI_VISUAL_TEMPERATURE`: Lower = more consistent, Higher = more creative
- `AUTO_TOKEN_PLACEMENT`: Disable to manually place characters  
- `MAP_TRANSITION_DETECTION`: Disable to manually create new maps

## 🔧 Troubleshooting

### AI Visuals Not Generating

**Check these common issues:**

1. **OpenAI API Key**: Ensure `OPENAI_API_KEY` is set and has credits
2. **Environment Variables**: Verify `AI_VISUAL_ENABLED=true`
3. **Model Access**: Confirm you have access to GPT-4
4. **Database Models**: Ensure Phase 10 database schema is applied

### Maps Not Updating

1. **Pusher Connection**: Verify real-time notifications from Phase 9 work
2. **Scene Integration**: Check that you're using the new visual scene resolution
3. **Browser Console**: Look for JavaScript errors in map rendering

### Performance Issues

1. **Debounce Settings**: Increase `VISUAL_UPDATE_DEBOUNCE` to reduce API calls
2. **Concurrent Limits**: Lower `MAX_CONCURRENT_VISUALS` if hitting rate limits
3. **Caching**: Increase `VISUAL_CACHE_DURATION` to reuse recent visual analysis

## 🎯 Advanced Features

### Manual Visual Commands

For special scenarios, you can manually trigger visual updates:

```typescript
import { updateVisuals, updateElements } from '@/lib/ai/scene-resolution-hook'

// Generate new map from description
await updateVisuals(campaignId, "The party enters a magnificent throne room")

// Add/remove elements during play
await updateElements(campaignId, [
  { action: 'add', elementName: 'Ancient Statue', elementType: 'object', description: 'A towering stone statue' },
  { action: 'move', elementName: 'Alice', position: 'approaches the throne' }
])
```

### Integration with Existing Systems

If you have custom scene resolution logic, wrap it:

```typescript
// In your existing scene resolver
import { SceneResolutionHook } from '@/lib/ai/scene-resolution-hook'

const result = await SceneResolutionHook.resolveSceneWithAIVisuals(
  sceneId, 
  playerActions, 
  campaignId,
  { 
    generateVisuals: true,
    updateCharacterPositions: true,
    autoSoundEffects: true
  }
)
```

## ✅ Verification Checklist

Before marking Phase 10.5 complete:

- [ ] AI visual generation working for different scene types
- [ ] Character tokens appear and move automatically  
- [ ] Interactive zones clickable and functional
- [ ] Real-time map updates visible to all players
- [ ] Mobile touch controls working
- [ ] Image library showing AI-generated content
- [ ] Performance acceptable (maps generate within 5-10 seconds)
- [ ] Fallback working when AI fails

## 🎉 Success!

With Phase 10.5 complete, your AI GM application now provides:

- **🤖 Fully Automated Visual Storytelling**: AI handles all map creation and updates
- **🎭 Immersive Player Experience**: Rich visuals with zero manual work
- **⚡ Real-time Visual Updates**: Maps change dynamically as story unfolds
- **📱 Mobile-Optimized Interface**: Touch-friendly controls for all devices
- **🎨 Atmospheric Consistency**: Visuals always match story mood and tone

**Your players now experience a fully visual, immersive AI-driven tabletop adventure! 🎲✨**

## 🚀 What's Next?

Ready for **Phase 11: Advanced AI Features**:
- Multiple AI model support (Claude, GPT-4, specialized models)
- Custom AI personalities and GMing styles  
- AI-generated artwork and character portraits
- Voice narration and speech synthesis
- Advanced campaign analytics and insights

Your AI Game Master is evolving into the most advanced virtual tabletop experience available! 🤖🎮
