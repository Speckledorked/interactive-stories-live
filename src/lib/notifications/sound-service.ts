// src/lib/notifications/sound-service.ts

export interface SoundEffect {
  id: string;
  name: string;
  file: string;
  volume: number;
  category: 'notification' | 'dramatic' | 'ambient' | 'ui';
  description: string;
}

export interface PlaySoundParams {
  soundId: string;
  volume?: number;
  fade?: boolean;
  delay?: number;
  loop?: boolean;
}

export class SoundService {
  private static audioContext: AudioContext | null = null;
  private static audioBuffers: Map<string, AudioBuffer> = new Map();
  private static currentSounds: Map<string, AudioBufferSourceNode> = new Map();
  private static masterVolume: number = 1.0;
  private static isEnabled: boolean = true;

  // Predefined sound effects library
  static readonly SOUNDS: Record<string, SoundEffect> = {
    // Notification Sounds
    'turn-reminder': {
      id: 'turn-reminder',
      name: 'Turn Reminder',
      file: '/sounds/turn-reminder.mp3',
      volume: 0.7,
      category: 'notification',
      description: 'Gentle reminder that it\'s your turn'
    },
    'your-turn': {
      id: 'your-turn',
      name: 'Your Turn',
      file: '/sounds/your-turn.mp3',
      volume: 0.8,
      category: 'notification',
      description: 'Energetic sound when your turn starts'
    },
    'mention': {
      id: 'mention',
      name: 'Mention',
      file: '/sounds/mention.mp3',
      volume: 0.6,
      category: 'notification',
      description: 'Soft ping when you\'re mentioned'
    },
    'whisper': {
      id: 'whisper',
      name: 'Whisper Received',
      file: '/sounds/whisper.mp3',
      volume: 0.5,
      category: 'notification',
      description: 'Subtle sound for private messages'
    },
    'scene-change': {
      id: 'scene-change',
      name: 'Scene Change',
      file: '/sounds/scene-change.mp3',
      volume: 0.8,
      category: 'notification',
      description: 'Dramatic transition sound for new scenes'
    },
    'scene-complete': {
      id: 'scene-complete',
      name: 'Scene Complete',
      file: '/sounds/scene-complete.mp3',
      volume: 0.9,
      category: 'notification',
      description: 'Triumphant sound when a scene resolves'
    },
    'turn-skipped': {
      id: 'turn-skipped',
      name: 'Turn Skipped',
      file: '/sounds/turn-skipped.mp3',
      volume: 0.6,
      category: 'notification',
      description: 'Gentle notification that a turn was skipped'
    },

    // Dramatic Moments
    'critical-success': {
      id: 'critical-success',
      name: 'Critical Success',
      file: '/sounds/critical-success.mp3',
      volume: 1.0,
      category: 'dramatic',
      description: 'Epic sound for critical hits and amazing rolls'
    },
    'critical-failure': {
      id: 'critical-failure',
      name: 'Critical Failure',
      file: '/sounds/critical-failure.mp3',
      volume: 0.9,
      category: 'dramatic',
      description: 'Dramatic failure sound for fumbles'
    },
    'danger': {
      id: 'danger',
      name: 'Danger',
      file: '/sounds/danger.mp3',
      volume: 0.8,
      category: 'dramatic',
      description: 'Tense sound for dangerous situations'
    },
    'victory': {
      id: 'victory',
      name: 'Victory',
      file: '/sounds/victory.mp3',
      volume: 1.0,
      category: 'dramatic',
      description: 'Triumphant fanfare for major victories'
    },
    'mystery': {
      id: 'mystery',
      name: 'Mystery',
      file: '/sounds/mystery.mp3',
      volume: 0.7,
      category: 'dramatic',
      description: 'Mysterious tone for plot revelations'
    },
    'horror': {
      id: 'horror',
      name: 'Horror',
      file: '/sounds/horror.mp3',
      volume: 0.8,
      category: 'dramatic',
      description: 'Spine-chilling sound for scary moments'
    },

    // Ambient Sounds
    'tavern': {
      id: 'tavern',
      name: 'Tavern Ambience',
      file: '/sounds/tavern-ambient.mp3',
      volume: 0.4,
      category: 'ambient',
      description: 'Background tavern atmosphere'
    },
    'dungeon': {
      id: 'dungeon',
      name: 'Dungeon Ambience',
      file: '/sounds/dungeon-ambient.mp3',
      volume: 0.4,
      category: 'ambient',
      description: 'Eerie dungeon atmosphere'
    },
    'forest': {
      id: 'forest',
      name: 'Forest Ambience',
      file: '/sounds/forest-ambient.mp3',
      volume: 0.4,
      category: 'ambient',
      description: 'Peaceful forest sounds'
    },
    'battle': {
      id: 'battle',
      name: 'Battle Music',
      file: '/sounds/battle-music.mp3',
      volume: 0.6,
      category: 'ambient',
      description: 'Intense combat background music'
    },

    // UI Sounds
    'notification': {
      id: 'notification',
      name: 'General Notification',
      file: '/sounds/notification.mp3',
      volume: 0.6,
      category: 'ui',
      description: 'General purpose notification sound'
    },
    'error': {
      id: 'error',
      name: 'Error',
      file: '/sounds/error.mp3',
      volume: 0.7,
      category: 'ui',
      description: 'Error notification sound'
    },
    'success': {
      id: 'success',
      name: 'Success',
      file: '/sounds/success.mp3',
      volume: 0.8,
      category: 'ui',
      description: 'Success notification sound'
    }
  };

  // Initialize audio context
  static async initialize() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    // Resume audio context if suspended
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    return this.audioContext;
  }

  // Load sound file
  static async loadSound(soundId: string): Promise<AudioBuffer> {
    if (this.audioBuffers.has(soundId)) {
      return this.audioBuffers.get(soundId)!;
    }

    const sound = this.SOUNDS[soundId];
    if (!sound) {
      throw new Error(`Sound ${soundId} not found`);
    }

    await this.initialize();

    try {
      const response = await fetch(sound.file);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);

      this.audioBuffers.set(soundId, audioBuffer);
      return audioBuffer;
    } catch (error) {
      console.warn(`Failed to load sound ${soundId}:`, error);
      throw error;
    }
  }

  // Play sound effect
  static async playSound(params: PlaySoundParams): Promise<void> {
    if (!this.isEnabled) return;

    try {
      const { soundId, volume = 1.0, fade = false, delay = 0, loop = false } = params;
      const audioBuffer = await this.loadSound(soundId);
      const sound = this.SOUNDS[soundId];

      if (!audioBuffer || !this.audioContext) return;

      // Stop any existing instance of this sound
      this.stopSound(soundId);

      // Create audio source
      const source = this.audioContext.createBufferSource();
      const gainNode = this.audioContext.createGain();

      source.buffer = audioBuffer;
      source.loop = loop;

      // Set volume
      const finalVolume = volume * sound.volume * this.masterVolume;
      gainNode.gain.value = fade ? 0 : finalVolume;

      // Connect nodes
      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      // Fade in if requested
      if (fade) {
        gainNode.gain.exponentialRampToValueAtTime(
          finalVolume,
          this.audioContext.currentTime + 0.5
        );
      }

      // Start playback
      const startTime = this.audioContext.currentTime + delay;
      source.start(startTime);

      // Store reference
      this.currentSounds.set(soundId, source);

      // Clean up when sound ends
      source.onended = () => {
        this.currentSounds.delete(soundId);
      };

    } catch (error) {
      console.warn(`Failed to play sound ${params.soundId}:`, error);
    }
  }

  // Stop sound
  static stopSound(soundId: string): void {
    const source = this.currentSounds.get(soundId);
    if (source) {
      try {
        source.stop();
      } catch (error) {
        // Sound might have already ended
      }
      this.currentSounds.delete(soundId);
    }
  }

  // Stop all sounds
  static stopAllSounds(): void {
    for (const [soundId] of this.currentSounds) {
      this.stopSound(soundId);
    }
  }

  // Set master volume
  static setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));

    // Apply to currently playing sounds
    for (const [soundId, source] of this.currentSounds) {
      // Note: This won't affect already playing sounds
      // New sounds will use the updated volume
    }
  }

  // Enable/disable sounds
  static setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.stopAllSounds();
    }
  }

  // Get sound info
  static getSoundInfo(soundId: string): SoundEffect | null {
    return this.SOUNDS[soundId] || null;
  }

  // Get all sounds by category
  static getSoundsByCategory(category: SoundEffect['category']): SoundEffect[] {
    return Object.values(this.SOUNDS).filter(sound => sound.category === category);
  }

  // Preload commonly used sounds
  static async preloadSounds(soundIds: string[]): Promise<void> {
    const promises = soundIds.map(id => this.loadSound(id).catch(err => {
      console.warn(`Failed to preload sound ${id}:`, err);
    }));

    await Promise.allSettled(promises);
  }

  // Play notification sound based on type
  static async playNotificationSound(notificationType: string): Promise<void> {
    const soundMap: Record<string, string> = {
      'TURN_REMINDER': 'turn-reminder',
      'SCENE_CHANGE': 'scene-change',
      'MENTION': 'mention',
      'WHISPER_RECEIVED': 'whisper',
      'SCENE_RESOLVED': 'scene-complete',
      'AI_RESPONSE_READY': 'notification',
      'WORLD_EVENT': 'mystery'
    };

    const soundId = soundMap[notificationType] || 'notification';
    await this.playSound({ soundId });
  }

  // Play dramatic moment sound
  static async playDramaticSound(momentType: string, intensity: number = 1.0): Promise<void> {
    const soundMap: Record<string, string> = {
      'critical_success': 'critical-success',
      'critical_failure': 'critical-failure',
      'major_victory': 'victory',
      'character_death': 'horror',
      'plot_twist': 'mystery',
      'combat_start': 'danger',
      'boss_battle': 'battle'
    };

    const soundId = soundMap[momentType];
    if (soundId) {
      await this.playSound({
        soundId,
        volume: intensity,
        fade: true
      });
    }
  }

  // Start ambient background sound
  static async startAmbientSound(sceneType: string): Promise<void> {
    // Stop any existing ambient sounds
    this.stopAmbientSounds();

    const ambientMap: Record<string, string> = {
      'tavern': 'tavern',
      'inn': 'tavern',
      'dungeon': 'dungeon',
      'cave': 'dungeon',
      'forest': 'forest',
      'wilderness': 'forest',
      'battle': 'battle',
      'combat': 'battle'
    };

    const soundId = ambientMap[sceneType.toLowerCase()];
    if (soundId) {
      await this.playSound({
        soundId,
        volume: 0.3,
        fade: true,
        loop: true
      });
    }
  }

  // Stop ambient sounds
  static stopAmbientSounds(): void {
    const ambientSounds = ['tavern', 'dungeon', 'forest', 'battle'];
    ambientSounds.forEach(soundId => this.stopSound(soundId));
  }

  // Test sound playback
  static async testSound(soundId: string): Promise<boolean> {
    try {
      await this.playSound({ soundId, volume: 0.5 });
      return true;
    } catch (error) {
      return false;
    }
  }

  // Get playback status
  static getPlaybackStatus() {
    return {
      isEnabled: this.isEnabled,
      masterVolume: this.masterVolume,
      activeSounds: Array.from(this.currentSounds.keys()),
      audioContextState: this.audioContext?.state || 'not-initialized'
    };
  }
}

export default SoundService;
