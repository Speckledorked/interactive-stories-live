// src/lib/tutorial/content/mechanics.ts
//
// The teaching content, as a version-controlled TypeScript registry.
//
// WHY NOT THE DATABASE. The previous tutorial stored its steps in the
// `tutorial_steps` table and seeded them from `initializeTutorialSteps()`,
// which had zero callers repo-wide — no seed script, no `prisma.seed` key,
// no migration INSERT. The table was empty in production, so /tutorial
// rendered a 0% progress bar over an empty list and taught nobody
// anything. Content in a table is content somebody has to remember to
// seed; content in a module is typechecked, reviewable in a diff, and
// impossible to forget. The database keeps only per-user PROGRESS.
//
// THE RULE THIS FILE OBEYS. MythOS deliberately hides its machine, and
// does so consistently: narration never mentions dice or moves, roll
// receipts are opt-in and collapsed, stress is hidden entirely, standing
// renders as "honored by" and debts as "considers you in his debt" rather
// than as a ledger counter. All of that exists because a visible meter
// turns a relationship into a resource to farm.
//
// Documentation can undo that from outside the UI. Teaching a player the
// exact rate standing moves at is the same harm as showing them a meter —
// it just arrives through a help page instead. So player-facing copy here
// explains THAT a system exists and WHAT IT FEELS LIKE, and never
// publishes thresholds, rates, caps, or numeric ranges.
// noPlayerFacingSpoilers.test.ts enforces this mechanically.
//
// SECOND RULE: players do not know this is a PbtA game, and must not
// learn it here. What they see are per-campaign labels — Campaign
// .statLabels renames the five stat keys and lib/ai/moveFlavor.ts renames
// the moves, so two campaigns show different names for the same thing.
// Copy that hardcoded "roll +sharp" would be wrong in most campaigns and
// meaningless in the rest. Everything below is phrased against what is
// actually on screen. See ./labels.ts for the resolver that substitutes a
// campaign's own names when there is a campaign in context.

export type MechanicCategory = 'playing' | 'world' | 'knowing' | 'table' | 'behind'

export const CATEGORY_LABELS: Record<MechanicCategory, string> = {
  playing: 'Playing',
  world: 'The world',
  // Not "What you know" — that is the name of a mechanic inside this
  // category, and a heading identical to one of its own entries reads as
  // a duplicate rather than a grouping.
  knowing: 'Knowing things',
  table: 'Your table',
  // Same reason as `knowing` above: "Behind the screen" is the name of
  // the mechanic in this category, so the heading has to differ from it.
  behind: 'How it works',
}

export const CATEGORY_ORDER: readonly MechanicCategory[] = [
  'playing',
  'world',
  'knowing',
  'table',
  'behind',
] as const

export interface Mechanic {
  /** Stable id — the /help/[mechanicId] route segment. Never displayed. */
  id: string
  /** The player-facing name. This is what the UI calls the thing. */
  term: string
  /** One sentence. Shown in the index and as the deep page's standfirst. */
  short: string
  /** Body paragraphs. Plain prose — no markdown is parsed. */
  body: string[]
  /**
   * Search keys, and the reason search works at all.
   *
   * Nobody looks up "information latency". They read "Heard secondhand"
   * on a rumor card and want to know what that means. Aliases are the
   * literal strings a player can see on screen, so the phrase they read
   * is the phrase that finds the explanation. The `term` is included
   * automatically — don't repeat it here.
   */
  aliases: string[]
  category: MechanicCategory
  /** Other mechanic ids worth reading next. */
  seeAlso?: string[]
}

export const MECHANICS: readonly Mechanic[] = [
  // ---------------------------------------------------------------- playing
  {
    id: 'scenes',
    category: 'playing',
    term: 'Scenes',
    short: 'A scene is a stretch of story you and the other players move through together.',
    body: [
      'Play happens in scenes. A scene opens somewhere, with whoever is present, and keeps going until someone ends it — there is no fixed length and no round limit.',
      'Everyone at the table acts in the same scene at the same time. When people have acted, MythOS resolves what they did together and writes what happens next, so your action and another player\'s land in the same moment of story rather than in separate turns.',
      'A scene that is still open is still live. You can leave and come back to it later.',
    ],
    aliases: ['scene', 'exchange', 'current scene', 'start a scene', 'new scene'],
    seeAlso: ['actions', 'ending-a-scene', 'scene-cost'],
  },
  {
    id: 'actions',
    category: 'playing',
    term: 'Taking an action',
    short: 'You write what your character does in your own words. There is no menu to pick from.',
    body: [
      'To act, describe what your character does. Anything you can say in a sentence, you can attempt — there is no list of allowed actions, and nothing you have to unlock before you can try it.',
      'Write what your character does and why, not what you want the outcome to be. "I put myself between her and the door" is something MythOS can resolve. "I win the argument" is a result, not an action, and gives it nothing to work with.',
      'Whether you succeed is settled before the story is written, not by the narrator deciding how your sentence sounded. Phrasing something more confidently does not make it more likely to work.',
      'Once you submit an action you cannot take it back. Read it once before you send it.',
    ],
    aliases: ['submit action', 'your action', 'what do you do', 'act', 'take an action'],
    seeAlso: ['scenes', 'transparency', 'harm'],
  },
  {
    id: 'ending-a-scene',
    category: 'playing',
    term: 'Ending a scene',
    short: 'Any player can end a scene — it is not the host\'s call alone.',
    body: [
      'When a scene has finished saying what it had to say, any player can end it. You do not need permission and you do not need to be the host.',
      'Ending a scene is what lets consequences settle and the story move on. A scene left open forever is a story stuck in one moment.',
      'Ending a scene is also when the scene is charged for. See "What a scene costs".',
    ],
    aliases: ['end scene', 'end the scene', 'close scene', 'wrap up'],
    seeAlso: ['scenes', 'scene-cost'],
  },
  {
    id: 'scene-cost',
    category: 'playing',
    term: 'What a scene costs',
    short: 'Scenes cost real money, charged when the scene ends and split across whoever took part.',
    body: [
      'MythOS writes with a paid AI model, and that costs real money. You are charged for it.',
      'The charge lands when a scene ends, not while you are playing, and it is split across the players who took part in that scene — not billed to the host alone.',
      'What you pay is the actual metered cost of the work that scene took, so a long scene with many exchanges costs more than a short one. Your balance is on your account page, and a scene will not start work its participants cannot cover.',
      'Nothing here charges you by surprise: you can see your balance before you begin, and ending a scene is a deliberate act.',
    ],
    aliases: ['cost', 'billing', 'balance', 'credits', 'charge', 'price', 'insufficient funds', 'pay'],
    seeAlso: ['ending-a-scene', 'scenes'],
  },
  {
    id: 'character-sheet',
    category: 'playing',
    term: 'Your character sheet',
    short: 'Your traits, how hurt you are, and anything currently affecting you.',
    body: [
      'Your sheet holds your character\'s traits — the handful of things they are naturally better or worse at. Every campaign names these itself, so the words on your sheet belong to your campaign\'s world rather than to a rulebook.',
      'Your traits shape what your character tends to be good at. They do not restrict what you may attempt; you can always try anything.',
      'The sheet also shows your health and anything currently affecting you — an injury, an aftereffect, something you picked up in a scene. These are the things it is useful to know before you decide what to do next.',
      'Some of what the world tracks about your character is deliberately not shown to you. That is not an oversight. Knowing exactly where you stand would turn playing a person into managing a number.',
    ],
    aliases: ['character sheet', 'my character', 'traits', 'stats', 'sheet'],
    seeAlso: ['harm', 'what-you-know', 'standing'],
  },
  {
    id: 'harm',
    category: 'playing',
    term: 'Getting hurt',
    short: 'Your health is on your sheet, and being badly hurt changes what happens to you in the story.',
    body: [
      'Your character can be hurt. Your health is shown on your sheet, and it is one of the few things about yourself you can read precisely — your own body is yours to know.',
      'Being hurt is a story fact, not just a lower number. A badly injured character has worse options and the narration treats them accordingly.',
      'Injuries heal. Time passing and quieter stretches of story both help.',
    ],
    aliases: ['health', 'harm', 'hurt', 'injury', 'wounded', 'damage', 'taken out', 'impaired'],
    seeAlso: ['character-sheet', 'downtime'],
  },
  {
    id: 'downtime',
    category: 'playing',
    term: 'Downtime',
    short: 'Quieter stretches between the action, where recovery and long projects happen.',
    body: [
      'Not everything happens at knifepoint. Downtime is the space between the tense scenes, where your character recovers, follows something up, or works on something slow.',
      'Things that cannot be done in a hurry belong here. So does healing.',
      'The world keeps moving during downtime. Taking your time has a cost measured in what other people did while you did.',
    ],
    aliases: ['downtime', 'rest', 'recover', 'between scenes'],
    seeAlso: ['harm', 'world-turn'],
  },

  {
    id: 'abilities',
    category: 'playing',
    term: 'Abilities and knowledge',
    short: 'What your character can do and understands, discovered through play rather than picked from a list.',
    body: [
      'Your sheet has an Abilities & Knowledge section. It fills in as the story reveals things — you do not choose from a catalogue at the start, and you cannot browse what you have not encountered.',
      'How well you know something is described in words rather than as a figure. That is the same reason nothing else here shows you a number: the narrator is never allowed to speak with a precision the fiction does not support, and neither is your sheet.',
      'Some things appear as a glimpse before you properly know them — a sense that there is something there, without the substance yet. That is a real state, not a loading message.',
      'What this world even has is itself something you discover. A campaign\'s systems are its own.',
    ],
    aliases: ['abilities', 'knowledge', 'abilities & knowledge', 'skills', 'powers', 'glimpsed', 'domain', 'what can i do'],
    seeAlso: ['character-sheet', 'what-you-know', 'corruption'],
  },
  {
    id: 'corruption',
    category: 'playing',
    term: 'Power at a cost',
    short: 'Some worlds have a price for certain kinds of power. Where they do, it shows in the fiction.',
    body: [
      'Not every campaign has this. Where a world\'s story includes power that costs something — and many do not — your character can accumulate that cost.',
      'Every campaign names it in its own terms, because it is part of that world\'s fiction rather than a system bolted on top.',
      'You will not see it as a meter. It shows in the way your character is written: what people notice, what the prose lingers on, what starts to change. That is deliberate, and it is the same principle as everything else here — the game tells you things in fiction, not in figures.',
      'It also opens doors that stay shut otherwise. What those are is for you to find out.',
    ],
    aliases: ['corruption', 'cost', 'taint', 'power at a cost', 'marks', 'changed'],
    seeAlso: ['abilities', 'character-sheet'],
  },
  {
    id: 'quests',
    category: 'world',
    term: 'Quests',
    short: 'Things you have taken on, tracked so nobody has to hold them in their head.',
    body: [
      'A quest is something your table has picked up — a job, a promise, a problem somebody asked you to solve. The Quests page keeps them so nobody has to remember what you agreed to three sessions ago.',
      'They come out of the story rather than a quest board. Somebody asks, you agree, and it appears.',
      'The world does not wait for you to get around to one. A situation you were asked to handle keeps developing whether or not you go, and it can resolve itself, or stop mattering, without you.',
    ],
    aliases: ['quest', 'quests', 'objective', 'mission', 'job', 'task'],
    seeAlso: ['world-turn', 'threads', 'factions'],
  },
  {
    id: 'wars',
    category: 'world',
    term: 'Wars',
    short: 'Open conflict between factions, fought over real places, resolving on its own schedule.',
    body: [
      'When factions stop manoeuvring and start fighting, it becomes a war with a front you can follow. Wars are fought over specific places, and holding one is a real thing that changes hands.',
      'A war moves on its own, in both directions, as part of the world turn. Which way it is going is described rather than scored.',
      'You can affect one, but you are one party in it. A war is not a puzzle waiting for you; it is other people pursuing something at each other\'s expense.',
      'Wars end. What follows one — who holds what, who owes whom — is where the next part of the story usually comes from.',
    ],
    aliases: ['war', 'wars', 'conflict', 'conflicts', 'battle', 'front', 'contested'],
    seeAlso: ['factions', 'world-turn', 'locations'],
  },

  // ------------------------------------------------------------------ world
  {
    id: 'world-turn',
    category: 'world',
    term: 'The world turn',
    short: 'The world keeps moving when nobody is playing.',
    body: [
      'MythOS runs the world on its own schedule, whether or not anyone logs in. Factions act on their plans. People travel, fall out, and die. Places change hands. News spreads.',
      'This is the part that makes the setting feel like a place rather than a backdrop. If you leave a situation alone, you do not come back to it paused — you come back to whatever it became.',
      'You will see the results as changes in the world: something you were tracking has moved, someone you knew is somewhere else, a rumor is going around that was not going around before.',
      'Nothing here happens behind your back to punish you. It happens because the people in this world want things and keep wanting them while you are away.',
    ],
    aliases: ['world turn', 'world tick', 'turn', 'the world moved', 'what changed', 'world events'],
    seeAlso: ['threads', 'factions', 'rumors'],
  },
  {
    id: 'threads',
    category: 'world',
    term: 'Threads',
    short: 'Situations in motion that fill up over time — someone\'s plan, a gathering storm, a countdown.',
    body: [
      'A thread is a situation that is going somewhere. A faction closing in on something it wants, a secret working its way toward the surface, a deadline approaching. Each one shows how far along it is.',
      'Threads advance from what happens in the story and from the world moving on its own. Acting against one can push it back; ignoring one lets it keep filling.',
      'When a thread completes, the thing it was building toward happens. That is the point of it — a thread is a promise the world makes about what is coming if nothing changes.',
      'You will not see every thread. Some are things nobody has told you about yet.',
    ],
    aliases: ['thread', 'threads', 'active threads', 'clock', 'clocks', 'countdown', 'progress'],
    seeAlso: ['world-turn', 'what-you-know', 'factions'],
  },
  {
    id: 'factions',
    category: 'world',
    term: 'Factions',
    short: 'Organized groups with their own goals, pursuing them whether or not you are involved.',
    body: [
      'Factions are the groups that matter in your world — houses, crews, orders, companies, whatever your setting calls them. Each has things it wants and works toward them on its own.',
      'A faction card shows how dangerous it currently is and how solid its position looks, described in plain terms rather than as figures. That is deliberate: the narrator itself is never allowed to speak in exact numbers about them, and neither is this.',
      'Factions notice what you do. Helping or crossing one changes how it treats you, and it remembers.',
      'They also deal with each other — alliances, debts, and open conflict between factions all move without you.',
    ],
    aliases: ['faction', 'factions', 'house', 'organization', 'threat', 'stability', 'dormant', 'watchful', 'dangerous', 'dire'],
    seeAlso: ['standing', 'world-turn', 'threads'],
  },
  {
    id: 'standing',
    category: 'world',
    term: 'Standing',
    short: 'How a faction regards you, described the way a person would describe it.',
    body: [
      'Factions form opinions of you. You will see that written the way someone in the world would say it — a group that owes you regard speaks of you differently from one you have crossed.',
      'You will not see a score. There is no bar to fill and no figure to optimize, because a relationship you can watch tick upward stops being a relationship and becomes a task.',
      'Standing is earned through what you actually do, over time, and it is worth something in proportion to who is offering it. Favour from a group barely holding together is not worth what it sounds like.',
      'Standing with groups you have not met, or that no longer exist, is simply not shown.',
    ],
    aliases: ['standing', 'reputation', 'honored by', 'regard', 'how they see me'],
    seeAlso: ['factions', 'debts', 'what-you-know'],
  },
  {
    id: 'debts',
    category: 'world',
    term: 'Debts and favours',
    short: 'Who owes whom, written as an obligation rather than a balance.',
    body: [
      'Obligations are real in this world and they are tracked. If someone considers you in their debt, you will be told so in those words.',
      'It is deliberately not shown as a ledger. An obligation is a piece of story with a person attached, and it behaves like one — it can be called in at an awkward moment, passed to someone else, or quietly forgotten by someone who no longer needs you.',
      'Debts run between factions too, not only to you. Sometimes a circle of obligations simply cancels itself out and everyone walks away even.',
    ],
    aliases: ['debt', 'debts', 'favour', 'favor', 'owes', 'in his debt', 'obligation'],
    seeAlso: ['standing', 'factions'],
  },
  {
    id: 'locations',
    category: 'world',
    term: 'Locations',
    short: 'Places with their own condition and weather, both of which change.',
    body: [
      'Places in your world are tracked, not just described. A location has a state — thriving, strained, falling apart — and that state moves with what happens there.',
      'Weather is real and local. It is worth reading before you plan something that depends on it.',
      'A place that has been fought over, cut off, or abandoned shows it. Coming back somewhere after a long absence is meant to tell you something.',
    ],
    aliases: ['location', 'locations', 'place', 'weather', 'condition', 'crumbling', 'strained', 'steady'],
    seeAlso: ['world-turn', 'factions'],
  },
  {
    id: 'npcs',
    category: 'world',
    term: 'People in the world',
    short: 'The characters MythOS plays. They have their own lives and continue them offscreen.',
    body: [
      'The people you meet are not scenery. They want things, they have their own relationships, and they act on both while you are elsewhere.',
      'They remember you. What you did in front of someone shapes how they deal with you later, and they will tell other people about it.',
      'What a person privately thinks of you is not shown to you, and is not something the narrator is told either. You learn where you stand with someone the way you would anywhere else — from how they behave.',
      'People can die, leave, or fall out with each other without you present.',
    ],
    aliases: ['npc', 'npcs', 'characters', 'people', 'who is this'],
    seeAlso: ['rumors', 'what-you-know', 'standing'],
  },

  // ---------------------------------------------------------------- knowing
  {
    id: 'what-you-know',
    category: 'knowing',
    term: 'What you know',
    short: 'You see what your character could plausibly have learned — not everything that is true.',
    body: [
      'The world holds more than you are shown. Places you have not found, people you have not met, and plans nobody has told you about are simply absent from your view, not greyed out — you cannot tell how much is missing, which is the honest version of not knowing.',
      'What you saw yourself is solid. You were there.',
      'What reached you some other way is only as good as the route it took. Those are marked differently, and the difference matters.',
      'This applies to your own character too. Some of what the world tracks about you is deliberately withheld, so that playing a person does not become reading a dashboard.',
    ],
    aliases: ['fog of war', 'what i know', 'hidden', 'undiscovered', 'not discovered', 'why cant i see'],
    seeAlso: ['rumors', 'threads', 'character-sheet'],
  },
  {
    id: 'rumors',
    category: 'knowing',
    term: 'Rumors and secondhand news',
    short: 'News travels through people, takes time, and does not always arrive intact.',
    body: [
      'Things that happen far away do not appear in front of you the moment they happen. Word has to travel, carried by people, and that takes time.',
      'Anything you did not witness is marked as secondhand. That marking is a warning, not decoration: what you have been told may be incomplete, exaggerated, out of date, or simply wrong.',
      'People pass on what they believe, and they have reasons of their own for what they choose to repeat. A rumor tells you something real about who is spreading it even when the content is false.',
      'The way to be sure of something is to go and see it.',
    ],
    aliases: ['rumor', 'rumors', 'heard secondhand', 'rumor-grade', 'may be inaccurate', 'gossip', 'news'],
    seeAlso: ['what-you-know', 'npcs', 'world-turn'],
  },

  // ------------------------------------------------------------------ table
  {
    id: 'turn-order',
    category: 'table',
    term: 'Turn order',
    short: 'A visible queue and timer. It never stops you from acting.',
    body: [
      'Play is freeform by default — anyone can act at any time, including in a fight.',
      'A table that wants more structure can turn on a turn queue for a scene. It shows whose turn it is and how long is left.',
      'The queue is advisory. Submitting an action is never blocked by it, and it is never your turn in a way that locks anyone else out. It exists to help a table take turns fairly, not to gate the button.',
    ],
    aliases: ['turn order', 'initiative', 'whose turn', 'turn queue', 'timer', 'waiting'],
    seeAlso: ['actions', 'scenes'],
  },
  {
    id: 'safety',
    category: 'table',
    term: 'Safety tools',
    short: 'Ways to stop, rewind, or rule out content — usable by anyone, without explaining why.',
    body: [
      'The X-Card is on the story page. Use it to pause or pull back from content you are not comfortable with. You never owe anyone a reason, and using it is not a disruption — it is the tool working.',
      'A campaign can set lines and veils before play: lines are things that will not appear at all, veils are things that happen off-screen. The host sets these, and they are worth agreeing on early rather than after something lands badly.',
      'The host can also set content warnings for the campaign so people know what they are joining.',
      'Any player can block another player, and report content to the host. Keeping the table comfortable is everyone\'s job, not one person\'s.',
    ],
    aliases: ['x-card', 'xcard', 'safety', 'lines and veils', 'content warning', 'block', 'report', 'uncomfortable'],
    seeAlso: ['chat', 'table-tools'],
  },
  {
    id: 'chat',
    category: 'table',
    term: 'In-character and out-of-character chat',
    short: 'Two channels: one your character is speaking in, one you are.',
    body: [
      'In-character chat is your character talking. Out-of-character chat is you talking — checking a detail, sorting out scheduling, saying you need a minute.',
      'Keeping them separate matters. It lets the table settle something real without it becoming part of the story, and it lets your character say something you personally disagree with.',
      'Chat is between the real players in your campaign. It is not how you take an action — actions go through the story page.',
    ],
    aliases: ['chat', 'ic', 'ooc', 'in character', 'out of character', 'talk'],
    seeAlso: ['actions', 'safety'],
  },
  {
    id: 'table-tools',
    category: 'table',
    term: 'Notes, maps, and the record',
    short: 'The supporting surfaces: your notes, scene maps, the codex, and the story log.',
    body: [
      'Notes are yours to keep, privately or shared with the table, for the things you want to remember — a name, a debt, a suspicion.',
      'Scenes can generate a map showing where everyone is. Position is still narrative: describe where your character moves as part of your action, and it is taken into account.',
      'The World view tracks the things that change every turn — people, factions, places, threads. The Codex holds the lore behind them. The Story Log is the chronicle of what has already happened.',
      'You can export your campaign\'s data if you want your own copy.',
    ],
    aliases: ['notes', 'map', 'maps', 'codex', 'story log', 'chronicle', 'export', 'world'],
    seeAlso: ['world-turn', 'what-you-know'],
  },
  {
    id: 'invites',
    category: 'table',
    term: 'Playing with other people',
    short: 'Share an invite link. There is no cap on party size.',
    body: [
      'A campaign is meant to be played with other people. Share an invite link from the Players panel and they join your table.',
      'There is no limit on how many people can be in a campaign.',
      'Everyone plays in the same scenes and the same world. What one player does is visible to the others, and is part of the same story.',
    ],
    aliases: ['invite', 'join', 'players', 'party', 'friends', 'multiplayer'],
    seeAlso: ['chat', 'scenes'],
  },

  // ----------------------------------------------------------------- behind
  {
    id: 'transparency',
    category: 'behind',
    term: 'Behind the screen',
    short: 'An optional panel showing exactly how an outcome was decided.',
    body: [
      'MythOS decides whether something worked before it writes what happened. The narration never mentions the machinery, because being told a story is the point.',
      'If you want to see it anyway, the transparency panel is there. It is collapsed by default and opening it is entirely your choice — some players find that knowing breaks the spell, and some find that not knowing breaks their trust. Both are catered for.',
      'Inside, you can see what an action was measured against, what the result was, and why the story turned the way it did. Nothing is hidden from you there; it is simply not pushed at you.',
      'The important guarantee is this: the outcome was settled before the prose was written. The narrator is describing a result, not choosing one.',
    ],
    // "AI Changes" is the literal heading on the panel itself
    // (AITransparencyPanel.tsx) — the string a player actually reads and
    // would search for. The rest are what they might call it instead.
    aliases: ['ai changes', 'transparency', 'roll', 'dice', 'why did that happen', 'receipt', 'how it was decided'],
    seeAlso: ['actions', 'what-you-know'],
  },
]

/** Lookup by id. Undefined for an unknown id — callers render a 404. */
export function getMechanic(id: string): Mechanic | undefined {
  return MECHANICS.find(m => m.id === id)
}

export function mechanicsByCategory(category: MechanicCategory): Mechanic[] {
  return MECHANICS.filter(m => m.category === category)
}

/**
 * Substring search over term, short text, and aliases.
 *
 * Aliases carry the weight here: a player searches the words they can see
 * on screen ("heard secondhand"), not the name of the concept
 * ("information latency"). Ranked so an alias/term hit beats a body hit.
 */
export function searchMechanics(query: string): Mechanic[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...MECHANICS]

  const scored = MECHANICS.map(m => {
    const term = m.term.toLowerCase()
    const aliases = m.aliases.map(a => a.toLowerCase())

    let score = 0
    if (term === q || aliases.includes(q)) score = 4
    else if (term.includes(q) || aliases.some(a => a.includes(q))) score = 3
    else if (m.short.toLowerCase().includes(q)) score = 2
    else if (m.body.some(p => p.toLowerCase().includes(q))) score = 1

    return { mechanic: m, score }
  }).filter(s => s.score > 0)

  scored.sort((a, b) => b.score - a.score || a.mechanic.term.localeCompare(b.mechanic.term))
  return scored.map(s => s.mechanic)
}
