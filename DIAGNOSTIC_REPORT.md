# Scene Resolution Diagnostic Report

**Generated**: November 22, 2025
**Issue**: Scenes not resolving or resolutions not interesting

---

## 🔍 Issues Found

### 1. **CRITICAL: Outdated AI Model Name**

**Location**: `src/lib/ai/client.ts:229`

**Current Code**:
```javascript
model: 'gpt-4-turbo-preview', // Deprecated model name
```

**Problem**:
- `gpt-4-turbo-preview` was deprecated by OpenAI in early 2024
- This model may no longer work or may return poor results
- OpenAI now uses different model naming

**Impact**: 🔴 **HIGH**
- AI calls may fail completely
- Responses may be low quality
- Scene resolutions won't be interesting

**Fix**: Update to current model names:
- `gpt-4o` (recommended - best performance)
- `gpt-4-turbo` (stable alternative)
- `gpt-4` (legacy but stable)

---

### 2. OpenAI API Key Configuration

**Status**: ✅ **CONFIGURED**
- API key is present in `.env`
- Key format looks valid (starts with `sk-proj-`)

---

### 3. Scene Resolution Flow

**How it works**:
1. Player submits action via `/api/campaigns/[id]/actions` (POST)
2. GM triggers resolution via `/api/campaigns/[id]/resolve-scene` (POST)
3. System calls `resolveScene()` in `sceneResolver.ts`
4. Builds AI request from world state
5. Calls OpenAI via `callAIGM()` in `client.ts`
6. Validates response
7. Applies world updates
8. Marks scene as RESOLVED

**Current Status**: ✅ Logic is correct

---

## 🐛 Potential Issues

### Why Scenes Might Not Resolve

1. **No Player Actions Submitted**
   - Scene status must be `AWAITING_ACTIONS`
   - At least one player action must be submitted
   - Check: Are players successfully submitting actions?

2. **Exchange System Blocking Resolution**
   - Exchange manager checks if all players have acted
   - Can be overridden with `forceResolve: true`
   - Check: Is multiplayer sync blocking resolution?

3. **AI Model Failure**
   - Deprecated model name causing errors
   - OpenAI API rate limits
   - Invalid API key
   - Network issues

4. **Validation Failure**
   - AI response doesn't match expected schema
   - Response is malformed JSON
   - Falls back to emergency template (boring)

### Why Resolutions Might Be Boring

1. **Using Emergency Fallback Template**
   - If AI validation fails, uses generic template
   - Check logs for "Using emergency fallback template"

2. **Insufficient World Context**
   - Empty character backstories
   - No active NPCs or factions
   - No clocks or tension
   - Recent timeline events are thin

3. **Poor AI System Prompt**
   - Current prompt is detailed but may need tuning
   - May need more creative direction
   - Could add more storytelling examples

4. **Model Temperature Too Low/High**
   - Current: `0.8` (good for creativity)
   - Too low (0.3): Boring, predictable
   - Too high (1.2): Chaotic, nonsensical

---

## ✅ What's Working

1. **Scene resolution logic** is solid and well-structured
2. **AI prompts** are comprehensive and detailed
3. **Error handling** includes circuit breakers and fallbacks
4. **Validation** has 3-tier progressive fallback
5. **Cost tracking** monitors API usage
6. **Multiplayer sync** prevents race conditions

---

## 🔧 Recommended Fixes

### Immediate (Do Now)

1. **Update AI Model Name**
   ```typescript
   // In src/lib/ai/client.ts line 229 and 607
   model: 'gpt-4o', // Latest and best model
   ```

2. **Test Scene Resolution**
   - Create a test campaign
   - Add 2-3 characters with rich backstories
   - Add NPCs and factions
   - Submit player actions
   - Trigger resolution
   - Check logs for errors

3. **Check AI Response Quality**
   - Enable debug mode: `AI_DEBUG_MODE=true` in `.env`
   - Resolve a scene
   - Check console logs for raw AI response
   - Verify scene_text is interesting and detailed

### Short-Term (Next Session)

4. **Improve Prompts If Needed**
   - Add more storytelling examples
   - Emphasize dramatic tension
   - Request more sensory details
   - Add genre-specific guidance

5. **Seed Rich World Data**
   - Create campaigns with detailed NPCs
   - Add faction goals and conflicts
   - Set up progress clocks
   - Populate timeline with events

6. **Add Scene Resolution UI Feedback**
   - Show loading state during AI call
   - Display progress (calling AI, validating, applying updates)
   - Show error messages clearly
   - Add retry button

### Long-Term (Optional)

7. **Scene Quality Scoring**
   - Measure scene_text length
   - Track player engagement
   - Request feedback after scenes
   - Tune prompts based on data

8. **Multiple AI Models**
   - Try different models for different purposes
   - GPT-4o for complex scenes
   - GPT-4-turbo for speed
   - Claude for longer context

9. **Human-in-the-Loop**
   - Let GM edit AI responses before publishing
   - Provide "regenerate" option
   - Allow manual world updates

---

## 📊 Testing Checklist

### Basic Scene Resolution Test

- [ ] Create new campaign from template
- [ ] Add 2+ characters with backstories
- [ ] Start first scene (should auto-generate intro)
- [ ] Submit action for each character
- [ ] Trigger resolution as GM
- [ ] Verify scene resolves without errors
- [ ] Check scene_text is interesting (>500 chars)
- [ ] Verify world updates applied (harm, clocks, etc.)
- [ ] Check new scene is created
- [ ] Repeat for 3-5 scenes

### AI Quality Test

- [ ] Enable `AI_DEBUG_MODE=true`
- [ ] Resolve a scene
- [ ] Check console for "System Prompt"
- [ ] Check console for "User Prompt"
- [ ] Check console for "Raw Response"
- [ ] Verify JSON is valid
- [ ] Verify scene_text is vivid and detailed
- [ ] Verify world_updates are present

### Error Handling Test

- [ ] Resolve scene with no actions (should error)
- [ ] Resolve already-resolved scene (should error)
- [ ] Simulate AI failure (invalid API key)
- [ ] Verify circuit breaker opens
- [ ] Verify emergency fallback works
- [ ] Restore API key and verify recovery

---

## 🎯 Expected Behavior

### Good Scene Resolution:
```
Scene Text Length: 800-2000 characters
Contains: Sensory details, character names, dialogue, tension
Updates: 2-5 world updates (harm, conditions, relationships)
Time: 5-15 seconds to resolve
Status: RESOLVED
Validation: "Full AI response validation passed"
```

### Bad Scene Resolution:
```
Scene Text Length: <300 characters
Contains: Generic summary, no detail, no dialogue
Updates: 0-1 world updates
Time: <2 seconds (emergency fallback)
Status: RESOLVED but boring
Validation: "Using emergency fallback template"
```

---

## 📝 Debugging Commands

### Check Scene Status
```bash
# Find current scene
psql $DATABASE_URL -c "SELECT id, sceneNumber, status FROM Scene WHERE campaignId='YOUR_CAMPAIGN_ID' ORDER BY sceneNumber DESC LIMIT 1;"

# Check player actions
psql $DATABASE_URL -c "SELECT id, actionText FROM PlayerAction WHERE sceneId='YOUR_SCENE_ID';"
```

### Check AI Metrics
```bash
# View cost tracking
curl http://localhost:3000/api/campaigns/YOUR_CAMPAIGN_ID/ai-metrics

# View campaign health
curl http://localhost:3000/api/campaigns/YOUR_CAMPAIGN_ID/health
```

### Test AI Call Directly
```javascript
// In Node.js console
const { callAIGM } = require('./src/lib/ai/client.ts');
const { buildSceneResolutionRequest } = require('./src/lib/ai/worldState.ts');

const request = await buildSceneResolutionRequest('campaignId', 'sceneId');
const response = await callAIGM(request, 'campaignId', 'sceneId', { debugMode: true });
console.log(response.scene_text);
```

---

## 🚨 Critical Action Required

**You MUST update the AI model name immediately.** The current model is deprecated and may not work.

**File**: `src/lib/ai/client.ts`
**Lines**: 229, 607

**Change from**:
```javascript
model: 'gpt-4-turbo-preview',
```

**Change to**:
```javascript
model: 'gpt-4o',
```

This single change should dramatically improve scene quality and reliability.

---

## 📞 Support

If issues persist after fixing the model name:

1. Check OpenAI API key is valid and has credits
2. Enable debug mode and check raw AI responses
3. Verify database has rich world data (NPCs, factions, clocks)
4. Check console logs for specific error messages
5. Try resolving scenes with 1-2 characters first
6. Ensure characters have backstories and goals

The system is well-built and should work excellently once the model name is updated.
