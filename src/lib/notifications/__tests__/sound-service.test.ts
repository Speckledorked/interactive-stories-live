// src/lib/notifications/__tests__/sound-service.test.ts
//
// Notification sound cues. The previous implementation loaded audio files
// from a directory that has never existed in this repo, so the whole
// channel silently delivered nothing; these are synthesized instead, which
// also makes the cue definitions testable data rather than binary assets.

import { describe, it, expect } from 'vitest'
import { SOUND_CUES, cueForNotificationType, SoundService } from '../sound-service'

describe('SOUND_CUES', () => {
  it('defines a playable cue for every id the type mapping can return', () => {
    const mapped = [
      'TURN_REMINDER', 'SCENE_CHANGE', 'SCENE_RESOLVED', 'AI_RESPONSE_READY',
      'MENTION', 'WHISPER_RECEIVED', 'SAFETY_ALERT', 'WORLD_EVENT', 'CAMPAIGN_MILESTONE',
    ]
    for (const type of mapped) {
      const cue = cueForNotificationType(type)
      expect(cue, `${type} should map to a cue`).not.toBeNull()
      expect(SOUND_CUES[cue!], `${cue} should exist`).toBeDefined()
    }
  })

  it('gives every cue at least one tone with a real duration', () => {
    for (const [id, cue] of Object.entries(SOUND_CUES)) {
      expect(cue.tones.length, `${id} has no tones`).toBeGreaterThan(0)
      for (const tone of cue.tones) {
        expect(tone.frequency, `${id} tone frequency`).toBeGreaterThan(0)
        expect(tone.duration, `${id} tone duration`).toBeGreaterThan(0)
        expect(tone.startAt, `${id} tone startAt`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('keeps every cue short — these fire while someone is reading', () => {
    for (const [id, cue] of Object.entries(SOUND_CUES)) {
      const end = Math.max(...cue.tones.map(t => t.startAt + t.duration))
      expect(end, `${id} runs too long`).toBeLessThanOrEqual(1)
    }
  })

  it('gives every cue a human-readable label', () => {
    for (const cue of Object.values(SOUND_CUES)) {
      expect(cue.label.length).toBeGreaterThan(0)
    }
  })
})

describe('cueForNotificationType', () => {
  it('distinguishes the types a player needs to tell apart by ear', () => {
    // A whisper and a safety alert sounding identical would defeat the point.
    expect(cueForNotificationType('WHISPER_RECEIVED')).not.toBe(cueForNotificationType('SAFETY_ALERT'))
    expect(cueForNotificationType('MENTION')).not.toBe(cueForNotificationType('TURN_REMINDER'))
  })

  it('groups the scene-progress types onto one cue', () => {
    expect(cueForNotificationType('SCENE_RESOLVED')).toBe(cueForNotificationType('SCENE_CHANGE'))
    expect(cueForNotificationType('AI_RESPONSE_READY')).toBe(cueForNotificationType('SCENE_CHANGE'))
  })

  it('returns null for types that should stay silent', () => {
    expect(cueForNotificationType('NOTE_SHARED')).toBeNull()
    expect(cueForNotificationType('FRIEND_REQUEST')).toBeNull()
    expect(cueForNotificationType('SOMETHING_UNKNOWN')).toBeNull()
  })
})

describe('SoundService.playSound', () => {
  it('resolves silently with no AudioContext rather than throwing', async () => {
    // Server-side rendering, an unsupported browser, or no audio device.
    // A notification that arrived but didn't chime must never surface as
    // an error.
    await expect(SoundService.playSound({ soundId: 'mention' })).resolves.toBeUndefined()
  })

  it('ignores an unknown cue id', async () => {
    await expect(SoundService.playSound({ soundId: 'no-such-cue' })).resolves.toBeUndefined()
  })

  it('is a no-op for a notification type with no cue', async () => {
    await expect(SoundService.playForNotificationType('NOTE_SHARED')).resolves.toBeUndefined()
  })
})
