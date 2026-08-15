// src/lib/ui/icons.ts
//
// One icon vocabulary for the whole app.
//
// The audit found ~229 emoji doing chrome work across 40 rendered files:
// entity-type markers in the wiki and command palette, notification-type
// glyphs, scene moods, and — the worst of them — `▼`/`▶` as disclosure
// arrows and `🔄`/`📖` as buttons. Emoji are a bad fit for that job for
// reasons that have nothing to do with taste: they render in a different
// font at a different optical weight from the surrounding text, they
// can't inherit `currentColor`, they vary by platform (the same glyph is
// a different picture on Android, iOS and Windows), and a screen reader
// announces their CLDR name mid-sentence.
//
// lucide-react was already a dependency used throughout the chrome, so
// this is adoption, not a new library.
//
// Every map here is keyed by the domain's own union type rather than a
// loose string, so adding a new entity type or scene mood is a
// typecheck error until it has an icon — which is how the emoji maps
// drifted in the first place.
//
// Emoji deliberately stay in two places, and only two:
//   - user content: anything a player typed, and the campaign-template
//     emoji in the create-campaign picker (author-chosen, part of the
//     data, not chrome).
//   - the wordmark's ◈ rule marks, which are typographic ornament rather
//     than iconography.

import {
  AlertTriangle,
  Backpack,
  Bell,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Clock,
  Coffee,
  Dices,
  Eye,
  Feather,
  Flag,
  Footprints,
  Globe,
  Hand,
  Handshake,
  Home,
  Landmark,
  Lock,
  Map as MapIcon,
  MessageSquare,
  Moon,
  Plus,
  Scroll,
  Search,
  Settings,
  Sparkles,
  Swords,
  Target,
  Trophy,
  User,
  UserPlus,
  Users,
  X,
  Zap,
  Drama,
  Bookmark,
  Link2,
  Keyboard,
} from 'lucide-react'

export type IconComponent = React.ComponentType<{ className?: string }>

/** Wiki/codex entry types — mirrors Prisma's WikiEntryType. */
export type WikiEntryTypeKey = 'NPC' | 'FACTION' | 'LOCATION' | 'CLOCK' | 'ITEM' | 'QUEST' | 'LORE' | 'CUSTOM'

export const ENTITY_ICONS: Record<WikiEntryTypeKey, IconComponent> = {
  NPC: User,
  FACTION: Swords,
  LOCATION: Landmark,
  CLOCK: Clock,
  ITEM: Backpack,
  QUEST: Scroll,
  LORE: BookOpen,
  CUSTOM: Bookmark,
}

/** Fallback for a related-link whose type isn't a known entity type. */
export const ENTITY_FALLBACK_ICON: IconComponent = Link2

/** Scene moods — mirrors SceneMoodTag's SceneMood union. */
export type SceneMoodKey =
  | 'combat'
  | 'social'
  | 'investigation'
  | 'stealth'
  | 'exploration'
  | 'downtime'
  | 'dramatic'
  | 'tense'
  | 'peaceful'

export const MOOD_ICONS: Record<SceneMoodKey, IconComponent> = {
  combat: Swords,
  social: MessageSquare,
  investigation: Search,
  stealth: Moon,
  exploration: MapIcon,
  downtime: Coffee,
  dramatic: Drama,
  tense: Zap,
  peaceful: Feather,
}

/**
 * Notification types. Deliberately a loose Record + explicit fallback
 * rather than a closed union: the server can add a type without a client
 * deploy, and an unknown one should render the generic bell, not crash.
 */
export const NOTIFICATION_ICONS: Record<string, IconComponent> = {
  TURN_REMINDER: Clock,
  SCENE_CHANGE: Clapperboard,
  MENTION: MessageSquare,
  WHISPER_RECEIVED: Lock,
  NOTE_SHARED: Feather,
  CAMPAIGN_INVITE: Dices,
  SCENE_RESOLVED: Check,
  AI_RESPONSE_READY: Bot,
  WORLD_EVENT: Globe,
  FRIEND_REQUEST: UserPlus,
  SAFETY_ALERT: Hand,
  CAMPAIGN_MILESTONE: Trophy,
}

export const NOTIFICATION_FALLBACK_ICON: IconComponent = Bell

/** Command-palette groups and one-off commands. */
export const COMMAND_ICONS = {
  lobby: Home,
  story: BookOpen,
  characters: Users,
  quests: Target,
  wiki: BookOpen,
  maps: MapIcon,
  roll: Dices,
  settings: Settings,
  submitAction: Feather,
  newScene: Clapperboard,
  endScene: Flag,
  create: Plus,
  shortcuts: Keyboard,
} as const

/** Consequence kinds — mirrors ConsequenceBadge's own union. */
export type ConsequenceKey = 'promise' | 'debt' | 'enemy' | 'longTermThreat'

export const CONSEQUENCE_ICONS: Record<ConsequenceKey, IconComponent> = {
  promise: Handshake,
  debt: Scroll,
  enemy: Swords,
  longTermThreat: AlertTriangle,
}

/**
 * Structural glyphs. These are the ones worth naming rather than
 * importing lucide directly at each call site, because their *meaning*
 * is what's shared — a disclosure arrow should be the same arrow
 * everywhere, whichever component draws it.
 */
export const UI_ICONS = {
  expanded: ChevronDown,
  collapsed: ChevronRight,
  forward: ChevronRight,
  success: Check,
  failure: X,
  warning: AlertTriangle,
  info: Sparkles,
  reveal: Eye,
  step: Footprints,
} as const
