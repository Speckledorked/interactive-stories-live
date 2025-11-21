# Phase 9: Sound Files Setup Guide

## 📁 Required Directory Structure

Create these directories in your project:

```
public/
└── sounds/
    ├── notification.mp3
    ├── turn-reminder.mp3
    ├── your-turn.mp3
    ├── mention.mp3
    ├── whisper.mp3
    ├── scene-change.mp3
    ├── scene-complete.mp3
    ├── turn-skipped.mp3
    ├── critical-success.mp3
    ├── critical-failure.mp3
    ├── danger.mp3
    ├── victory.mp3
    ├── mystery.mp3
    ├── horror.mp3
    ├── error.mp3
    ├── success.mp3
    └── ambient/
        ├── tavern-ambient.mp3
        ├── dungeon-ambient.mp3
        ├── forest-ambient.mp3
        └── battle-music.mp3
```

## 🎵 Sound File Requirements

### Format Specifications:
- **Format**: MP3 (for best browser compatibility)
- **Bitrate**: 128kbps (good quality, reasonable file size)
- **Duration**: 1-5 seconds for notification sounds, longer for ambient
- **Sample Rate**: 44.1kHz
- **File Size**: Keep under 100KB for notification sounds

### Sound Categories:

#### Notification Sounds (1-2 seconds)
- `notification.mp3` - General notification
- `turn-reminder.mp3` - Gentle turn reminder
- `your-turn.mp3` - Energetic "your turn" alert
- `mention.mp3` - Soft mention ping
- `whisper.mp3` - Subtle whisper notification
- `scene-change.mp3` - Scene transition
- `scene-complete.mp3` - Scene resolution
- `turn-skipped.mp3` - Turn skip notification

#### Dramatic Sounds (2-3 seconds)
- `critical-success.mp3` - Epic success sound
- `critical-failure.mp3` - Dramatic failure
- `danger.mp3` - Tension/danger alert
- `victory.mp3` - Triumphant fanfare
- `mystery.mp3` - Mysterious tone
- `horror.mp3` - Spine-chilling effect

#### UI Sounds (0.5-1 second)
- `error.mp3` - Error notification
- `success.mp3` - Success confirmation

#### Ambient Sounds (30+ seconds, loopable)
- `tavern-ambient.mp3` - Tavern background
- `dungeon-ambient.mp3` - Dungeon atmosphere
- `forest-ambient.mp3` - Forest ambience
- `battle-music.mp3` - Combat background

## 🎨 Free Sound Resources

### Where to Find Free Sounds:

1. **Freesound.org** (CC Licensed)
   - High-quality sound effects
   - Search for: "notification", "ding", "chime", "success", "fail"

2. **Zapsplat** (Free with account)
   - Professional sound effects
   - Game-specific sounds available

3. **BBC Sound Effects** (Free for personal use)
   - Professional broadcast quality
   - Wide variety of effects

4. **YouTube Audio Library** (Royalty-free)
   - Music and sound effects
   - No attribution required

### Search Terms for Finding Sounds:
- Notifications: "notification", "ding", "chime", "ping", "bell"
- Success: "success", "win", "achievement", "fanfare"
- Failure: "fail", "error", "negative", "buzz"
- Dramatic: "stinger", "hit", "impact", "crescendo"
- Ambient: "ambience", "atmosphere", "background", "loop"

## 🛠️ Creating Your Own Sounds

### Tools:
- **Audacity** (Free) - Audio editing
- **GarageBand** (Mac) - Music creation
- **Reaper** (Paid) - Professional audio

### Tips:
1. Keep notification sounds short and pleasant
2. Test volume levels across different devices
3. Ensure sounds loop seamlessly for ambient tracks
4. Use fade-in/fade-out for smooth playback

## 📝 Implementation Notes

### File Naming Convention:
- Use lowercase with hyphens
- Be descriptive but concise
- Match the sound IDs in the code

### Browser Compatibility:
- MP3 is supported in all modern browsers
- OGG Vorbis as fallback (optional)
- WAV for highest quality (larger files)

### Performance Considerations:
- Preload commonly used sounds
- Use audio sprites for multiple short sounds
- Implement proper caching headers

## 🚀 Quick Setup Commands

```bash
# Create sound directories
mkdir -p public/sounds/ambient

# Download sample sounds (placeholder - replace with actual sounds)
# You'll need to manually download and place sound files

# Test directory structure
ls -la public/sounds/
```

## ⚠️ Important Notes

1. **Copyright**: Ensure all sounds are properly licensed for your use
2. **Attribution**: Follow license requirements for attributed sounds
3. **File Size**: Keep total sound library under 5MB for good performance
4. **Testing**: Test sounds on different devices and volume levels
5. **Fallbacks**: Implement graceful fallbacks if sounds fail to load

## 🎯 Recommended Starter Pack

For a quick start, find these essential sounds:
1. `notification.mp3` - Simple, pleasant ding
2. `your-turn.mp3` - Upbeat notification
3. `mention.mp3` - Soft ping
4. `scene-change.mp3` - Transition whoosh
5. `success.mp3` - Positive confirmation
6. `error.mp3` - Gentle negative tone

Once you have these core sounds, the notification system will work perfectly!
