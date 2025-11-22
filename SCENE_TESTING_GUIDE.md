# Scene Resolution Testing Guide

This guide helps you test and verify that scene resolution is working properly.

---

## 🚀 Quick Test (5 Minutes)

### Step 1: Create a Test Campaign

1. Go to your app (localhost:3000 or deployed URL)
2. Login as admin user
3. Click "Create Campaign" (or use API: `POST /api/campaigns`)
4. Use a template (recommended: "PbtA Fantasy Adventure")
5. Fill in:
   - **Title**: "Test Campaign"
   - **Universe**: "High fantasy"
   - **Template**: PbtA Fantasy Adventure
   - **Initial Seed**: Leave default or write something dramatic

### Step 2: Create Test Characters

Create 2 characters with rich backstories:

**Character 1: "Kara the Bold"**
```
Name: Kara
Pronouns: she/her
Description: A scarred veteran warrior with a mysterious past
Backstory: Once a renowned knight, Kara abandoned her oath after discovering her king's corruption. Now she wanders, seeking redemption.
Goals: Find the truth about her missing sister; prevent the king's dark ritual
Stats: cool +1, hard +2, hot -1, sharp +1, weird +0
```

**Character 2: "Finn the Clever"**
```
Name: Finn
Pronouns: he/him
Description: A quick-witted thief with a heart of gold
Backstory: Grew up on the streets of the capital, Finn learned to survive by his wits. He joined the rebellion after witnessing the king's cruelty.
Goals: Steal the Crown Jewels; save his mentor from the dungeons
Stats: cool +2, hard +0, hot +1, sharp +1, weird -1
```

### Step 3: Start First Scene

The system should auto-generate a scene intro. If not, call:
```
POST /api/campaigns/{id}/scene
```

**Expected**: You get an interesting scene introduction (300-500 words) setting up a dramatic situation.

### Step 4: Submit Player Actions

Have each character submit a dramatic action:

**Kara's Action**:
```
I draw my sword and step between the bandits and the frightened villagers.
"You want them? You'll have to go through me first."
I adopt a defensive stance, ready to strike if they attack.
```

**Finn's Action**:
```
While Kara distracts them, I quietly circle around behind the bandits, looking for their leader.
I want to get close enough to pickpocket their coin purse and maybe find out who hired them.
```

**Submit via**:
```
POST /api/campaigns/{campaignId}/actions
{
  "sceneId": "...",
  "characterId": "...",
  "actionText": "..."
}
```

### Step 5: Resolve the Scene (THE CRITICAL TEST)

As the GM/admin, trigger resolution:

```
POST /api/campaigns/{campaignId}/resolve-scene
```

**Watch the console logs**. You should see:
```
🎬 Starting scene resolution...
✅ Scene marked as RESOLVING
📊 Building AI request...
🤖 Calling AI GM...
✅ AI GM responded
Scene text length: 1500-2500 (good!)
💾 Applying world updates...
✅ Scene marked as RESOLVED
```

### Step 6: Check the Resolution

**Good Resolution**:
- ✅ Scene text is **800+ words** (ideally 1000-2000)
- ✅ Uses sensory details (what they see, hear, smell)
- ✅ Includes dialogue from NPCs
- ✅ Both characters are referenced by name
- ✅ Actions have clear consequences
- ✅ Ends with a hook or new situation
- ✅ Feels dramatic and engaging

**Bad Resolution** (needs investigation):
- ❌ Scene text is <300 words
- ❌ Generic and boring
- ❌ No dialogue
- ❌ Just a summary
- ❌ Characters not mentioned
- ❌ No tension or stakes

### Step 7: Verify World Updates

Check that the resolution applied updates:

**Expected**:
- Characters may have taken harm (if combat occurred)
- Relationships with NPCs changed (trust/tension/respect)
- New timeline events created
- Clocks advanced (if relevant)
- Character locations updated

**Check via**:
```sql
-- Check harm updates
SELECT name, harm FROM Character WHERE campaignId = '...';

-- Check timeline
SELECT title, summaryPublic FROM TimelineEvent
WHERE campaignId = '...'
ORDER BY turnNumber DESC LIMIT 5;

-- Check clocks
SELECT name, currentTicks, maxTicks FROM Clock
WHERE campaignId = '...';
```

---

## 🐛 Troubleshooting

### Problem: "No active scene to resolve"

**Cause**: No scene is in AWAITING_ACTIONS status

**Fix**:
1. Check scene status: `SELECT id, sceneNumber, status FROM Scene WHERE campaignId='...' ORDER BY sceneNumber DESC LIMIT 1;`
2. If no scenes exist, create one: `POST /api/campaigns/{id}/scene`
3. If scene is already RESOLVED, create a new scene

### Problem: "No player actions submitted yet"

**Cause**: Scene exists but no actions submitted

**Fix**:
1. Submit actions for each character
2. Ensure actions are linked to correct sceneId
3. Check: `SELECT COUNT(*) FROM PlayerAction WHERE sceneId='...';`

### Problem: "AI response validation failed"

**Cause**: OpenAI returned invalid JSON or response doesn't match schema

**Fix**:
1. Enable debug mode: `AI_DEBUG_MODE=true` in `.env`
2. Restart server
3. Try resolution again
4. Check console for "Raw Response"
5. Verify API key has credits
6. Check OpenAI status: https://status.openai.com

### Problem: "OpenAI API error"

**Possible Causes**:
- Invalid API key
- No credits remaining
- Rate limit exceeded
- Network issues
- Model name incorrect

**Fix**:
1. Verify API key in `.env`
2. Check OpenAI account: https://platform.openai.com/usage
3. Verify model name is `gpt-4o` (latest)
4. Wait 1 minute and retry (rate limit)

### Problem: "Circuit breaker OPEN"

**Cause**: Too many AI failures in a row (3+)

**Fix**:
1. Wait 5 minutes for circuit breaker to reset
2. Fix underlying issue (API key, model name, etc.)
3. Retry resolution
4. If it works, circuit breaker closes automatically

### Problem: "Scene text is boring/short"

**Possible Causes**:
1. Using emergency fallback template
2. AI model not performing well
3. Insufficient world context
4. Poor character backstories

**Fix**:
1. Check logs for "Using emergency fallback template"
2. Verify model is `gpt-4o` not deprecated name
3. Enrich world data:
   - Add detailed NPC descriptions
   - Create faction goals and conflicts
   - Set up progress clocks
   - Add timeline events
4. Give characters rich backstories and goals
5. Increase temperature if too predictable (0.8 is good)

---

## 📊 Performance Benchmarks

### Healthy Resolution:
```
Response Time: 5-15 seconds
Scene Text Length: 1000-2500 characters
World Updates: 3-7 updates
Validation: "Full AI response validation passed"
Cost: ~$0.05-0.15 per scene (GPT-4o)
```

### Warning Signs:
```
Response Time: <2 seconds (emergency fallback)
Response Time: >30 seconds (slow API)
Scene Text Length: <500 characters (poor quality)
Validation: "Using partial AI response" (schema mismatch)
Validation: "Using emergency fallback" (complete failure)
```

---

## 🎯 Advanced Testing

### Test Complex Exchanges (Multiple Characters)

1. Create 3-4 characters
2. Have them all submit actions in same scene
3. Make actions interact (one helps another, conflicts)
4. Verify resolution handles all actions coherently

### Test Combat

1. Create scene with hostile NPCs
2. Have characters attack
3. Verify harm is applied correctly
4. Check conditions (Bleeding, Stunned, etc.) are added
5. Verify combat feels dramatic, not mechanical

### Test Failure

1. Submit action that should fail (low stats, hard task)
2. Make a dice roll that fails (6-)
3. Verify scene shows interesting failure
4. Check that failure advances story (complications, new problems)

### Test Relationships

1. Have character help/hurt an NPC
2. Check relationship changes in database
3. In next scene, verify NPC behavior reflects relationship
4. Example: High trust → NPC shares secrets

### Test Clocks

1. Create a clock (e.g., "Enemy Army Advances" 0/6)
2. Have actions that should advance it
3. Verify clock ticks in resolution
4. When clock completes, verify consequence fires

---

## ✅ Success Criteria

Your scene resolution is working excellently if:

1. ✅ Scenes resolve in 5-15 seconds
2. ✅ Scene text is 1000+ words with rich detail
3. ✅ Includes sensory descriptions and dialogue
4. ✅ Each character's action is addressed
5. ✅ Consequences are clear and meaningful
6. ✅ World updates are applied correctly
7. ✅ NPCs feel alive with distinct personalities
8. ✅ Failures are as interesting as successes
9. ✅ Each scene ends with a hook
10. ✅ Players are excited to read and respond

---

## 🎨 Example of Excellent Scene Resolution

**Scene Intro**:
> The goblin camp sprawls across the ravine, dozens of crude tents surrounding a massive bonfire. You can hear their guttural chanting, smell the roasting meat (probably stolen from nearby farms), and see shadows dancing in the firelight. Your mission: rescue the kidnapped mayor's daughter before dawn.

**Player Actions**:
- Kara: "I signal Finn to wait, then I carefully approach from the north, using the rocks for cover. I'm looking for where they're keeping prisoners."
- Finn: "I move to the south side and start making bird calls - our signal. When the goblins are distracted, I'll sneak in and find the girl."

**AI Resolution** (1200 words):
> The ravine floor was slick with recent rain, each footstep a calculated risk against the loose gravel that could betray Kara's approach. She pressed herself against the rough basalt, feeling the cold stone bite through her worn leather armor. Below, the goblin camp teemed with chaotic energy—she counted at least forty of the creatures, their greenish skin glistening in the firelight as they gorged themselves on what looked suspiciously like Farmer Hendrick's prized pig.
>
> Kara's eyes swept the camp methodically, the way her old commander had taught her. *Assess, adapt, act.* Three large tents dominated the western edge, guarded by goblins wearing what passed for armor among their kind—rusted chainmail and mismatched helmets. That had to be where they kept valuable prisoners.
>
> From across the ravine, a bird call cut through the night. Too precise, too musical—Finn's signal. Kara suppressed a smile. The boy had talent, she'd give him that.
>
> Below, several goblins perked up at the sound. "Wha' was tha'?" one grunted, his voice like gravel in a blender.
>
> "Prob'ly nothin'. Jes' a bird," another replied, but he was already moving toward the southern edge, others following...
>
> [Continues for 800+ more words with vivid description, dialogue, and tension building to a dramatic cliffhanger]

**World Updates**:
```json
{
  "pc_changes": [
    {
      "character_name_or_id": "Kara",
      "changes": {
        "location": "Inside the goblin camp, near the prisoner tent",
        "relationship_changes": [
          {
            "entity_id": "mayors_daughter_npc",
            "entity_name": "Elara (Mayor's Daughter)",
            "trust_delta": 30,
            "reason": "Kara risked her life to attempt rescue"
          }
        ]
      }
    }
  ],
  "new_timeline_events": [
    {
      "title": "Infiltration of the Goblin Camp",
      "summary_public": "Kara and Finn attempted a daring nighttime rescue...",
      "summary_gm": "Kara identified the prisoner location. Finn's distraction drew 15 goblins away..."
    }
  ],
  "clock_changes": [
    {
      "clock_name_or_id": "Dawn Approaches",
      "delta": 1
    }
  ]
}
```

This is what you're aiming for!

---

## 📝 Final Checklist

Before declaring "scenes are working":

- [ ] Created test campaign with template
- [ ] Added 2+ characters with rich backstories
- [ ] Scene intro auto-generated and interesting
- [ ] Submitted actions for all characters
- [ ] Resolution triggered without errors
- [ ] Scene text is 1000+ words
- [ ] Scene includes sensory details
- [ ] Scene includes NPC dialogue
- [ ] All character actions addressed
- [ ] World updates applied correctly
- [ ] Next scene can be created
- [ ] Repeated successfully 3+ times
- [ ] Console shows no errors
- [ ] AI_DEBUG_MODE confirms good AI responses

If all boxes checked: **Scenes are working! 🎉**

If any fail: See troubleshooting section above.
