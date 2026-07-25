// src/lib/notifications/sound-service.ts
//
// Notification sounds, synthesized in the browser (README #10/#63/#64).
//
// The previous version loaded audio files from `/sounds/…` — a directory
// that has never existed in this repo — so every call failed silently and
// the whole channel delivered nothing. Rather than ship binary assets
// (which can't be reviewed in a diff, bloat the bundle, and would have to
// be licensed), each cue is generated with the Web Audio API: a couple of
// oscillators and a gain envelope, which is all a notification chime
// actually is.
//
// That also makes the cues *data* — a few numbers per sound, visible and
// tweakable right here. If real recorded audio is wanted later,
// `playSound` is the single seam: swap its body for an <audio> load and
// every caller keeps working.

/** A single tone within a cue. */
interface Tone {
  /** Hz. */
  frequency: number
  /** Seconds from the cue's start. */
  startAt: number
  /** Seconds. */
  duration: number
  type?: OscillatorType
}

interface SoundCue {
  label: string
  tones: Tone[]
}

/**
 * The cue library. Deliberately short and distinguishable rather than
 * musical: these fire while someone is reading, and a long flourish is
 * worse than a two-note ping.
 */
export const SOUND_CUES: Record<string, SoundCue> = {
  'turn-reminder': {
    label: 'Turn reminder',
    // Rising pair — "your move".
    tones: [
      { frequency: 587.33, startAt: 0, duration: 0.12 },
      { frequency: 880.0, startAt: 0.1, duration: 0.18 },
    ],
  },
  'scene-change': {
    label: 'Scene change',
    // Three ascending notes — something new is starting.
    tones: [
      { frequency: 523.25, startAt: 0, duration: 0.1 },
      { frequency: 659.25, startAt: 0.09, duration: 0.1 },
      { frequency: 783.99, startAt: 0.18, duration: 0.2 },
    ],
  },
  mention: {
    label: 'Mention',
    // Bright double-tap — someone said your name.
    tones: [
      { frequency: 1046.5, startAt: 0, duration: 0.07 },
      { frequency: 1046.5, startAt: 0.12, duration: 0.1 },
    ],
  },
  whisper: {
    label: 'Whisper',
    // Soft, low, single — private by feel as well as by fact.
    tones: [{ frequency: 392.0, startAt: 0, duration: 0.22, type: 'sine' }],
  },
  'critical-moment': {
    label: 'Critical moment',
    // Falling minor third — something went wrong.
    tones: [
      { frequency: 440.0, startAt: 0, duration: 0.16 },
      { frequency: 349.23, startAt: 0.14, duration: 0.3, type: 'triangle' },
    ],
  },
  'world-event': {
    label: 'World event',
    // Low swell — the world moved while you weren't looking.
    tones: [
      { frequency: 261.63, startAt: 0, duration: 0.3, type: 'triangle' },
      { frequency: 329.63, startAt: 0.12, duration: 0.3, type: 'triangle' },
    ],
  },
}

export type SoundId = keyof typeof SOUND_CUES

/** Maps a NotificationType to its cue, or null for types with no sound. */
export function cueForNotificationType(type: string): SoundId | null {
  switch (type) {
    case 'TURN_REMINDER':
      return 'turn-reminder'
    case 'SCENE_CHANGE':
    case 'SCENE_RESOLVED':
    case 'AI_RESPONSE_READY':
      return 'scene-change'
    case 'MENTION':
      return 'mention'
    case 'WHISPER_RECEIVED':
      return 'whisper'
    case 'SAFETY_ALERT':
      return 'critical-moment'
    case 'WORLD_EVENT':
    case 'CAMPAIGN_MILESTONE':
      return 'world-event'
    default:
      return null
  }
}

// One shared AudioContext: browsers cap how many a page may create, and
// creating one per sound leaks them.
let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext || (window as any).webkitAudioContext
  if (!Ctor) return null
  if (!audioContext) audioContext = new Ctor()
  return audioContext
}

export class SoundService {
  /**
   * Play a cue. Resolves when scheduled, not when finished — callers are
   * firing these as a side effect of a notification arriving and shouldn't
   * be made to await the audio.
   *
   * Never throws. Autoplay policy means the very first cue before any user
   * interaction may be suppressed by the browser; that's expected and not
   * worth surfacing as an error.
   */
  static async playSound({
    soundId,
    volume = 0.5,
  }: {
    soundId: string
    volume?: number
  }): Promise<void> {
    const cue = SOUND_CUES[soundId]
    if (!cue) return

    const ctx = getAudioContext()
    if (!ctx) return

    try {
      // Browsers start the context suspended until a user gesture.
      if (ctx.state === 'suspended') await ctx.resume()

      const safeVolume = Math.max(0, Math.min(1, volume))
      const now = ctx.currentTime

      for (const tone of cue.tones) {
        const oscillator = ctx.createOscillator()
        const gain = ctx.createGain()

        oscillator.type = tone.type ?? 'sine'
        oscillator.frequency.setValueAtTime(tone.frequency, now + tone.startAt)

        // Short attack and an exponential release — a raw square-edged
        // gain change produces an audible click at both ends.
        const start = now + tone.startAt
        const end = start + tone.duration
        gain.gain.setValueAtTime(0.0001, start)
        gain.gain.exponentialRampToValueAtTime(safeVolume, start + 0.012)
        gain.gain.exponentialRampToValueAtTime(0.0001, end)

        oscillator.connect(gain)
        gain.connect(ctx.destination)
        oscillator.start(start)
        oscillator.stop(end + 0.02)
      }
    } catch {
      // Autoplay blocked, context closed, or no audio device. Silence is
      // the correct failure mode for a notification chime.
    }
  }

  /** Play the cue matching a notification type, if it has one. */
  static async playForNotificationType(type: string, volume = 0.5): Promise<void> {
    const cue = cueForNotificationType(type)
    if (cue) await this.playSound({ soundId: cue, volume })
  }
}
