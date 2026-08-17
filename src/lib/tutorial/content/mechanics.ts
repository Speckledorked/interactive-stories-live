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
// EXPLAIN THE MECHANISM, WITHOUT THE NUMBERS. These two are often
// confused, and the first draft of this file confused them: it said what
// each system FELT like and stopped, which left a reader knowing that
// factions exist without any idea what makes one move. That is not
// fog of war, it is just a thin help page.
//
// The real rule is narrower. MythOS hides its machine deliberately —
// stress is fully hidden, relationships are hidden because "a visible
// meter turns a relationship into a resource to farm", proficiency is
// banded, debts render as an obligation and "never as a ledger counter".
// What that protects against is a player OPTIMIZING against exposed
// figures. It does not protect against a player understanding how the
// world works, and keeping them ignorant of that makes the simulation
// look like randomness.
//
// So: explain what drives a system, what changes it, and what your lever
// on it is. Never publish the thresholds, rates, caps or ranges that
// would turn understanding into a farming route.
// noPlayerFacingSpoilers.test.ts enforces the second half mechanically.
//
// SECOND RULE: players do not know this is a PbtA game, and must not
// learn it here. What they see are per-campaign labels — Campaign
// .statLabels renames the five stat keys and lib/ai/moveFlavor.ts renames
// the moves, so two campaigns show different names for the same thing.
// Copy that hardcoded "roll +sharp" would be wrong in most campaigns and
// meaningless in the rest. Everything below is phrased against what is
// actually on screen. See ./labels.ts for the resolver that substitutes a
// campaign's own names when there is a campaign in context.

export type MechanicCategory = 'playing' | 'world' | 'knowing' | 'table' | 'building' | 'behind'

export const CATEGORY_LABELS: Record<MechanicCategory, string> = {
  playing: 'Playing',
  world: 'The world',
  // Not "What you know" — that is the name of a mechanic inside this
  // category, and a heading identical to one of its own entries reads as
  // a duplicate rather than a grouping.
  knowing: 'Knowing things',
  table: 'Your table',
  building: 'Making a world',
  // Same reason as `knowing`: "Behind the screen" is the name of the
  // mechanic in this category, so the heading has to differ from it.
  behind: 'How it works',
}

export const CATEGORY_ORDER: readonly MechanicCategory[] = [
  'playing',
  'world',
  'knowing',
  'table',
  'building',
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
    short: 'A stretch of story you and the other players move through together, resolved a round at a time.',
    body: [
      'Play happens in scenes. A scene opens somewhere, with whoever is present, and keeps going until someone ends it — there is no fixed length and no round limit.',
      'Everyone acts in the same scene at the same time. A round of actions is called an exchange: people submit what they do, and MythOS resolves the whole exchange together and writes what happens next. That is why your action and another player\'s land in the same moment of story rather than in separate turns.',
      'Resolution happens in a fixed order. Outcomes are decided first, from your character and the situation. Only then is the prose written, and the writer is told what already happened. This is why a scene can go badly for you even when the narration is generous, and why arguing with the narrator cannot change a result.',
      'A scene that is still open is still live. You can leave and come back to it later, and other players can act while you are gone.',
    ],
    aliases: ['scene', 'exchange', 'current scene', 'start a scene', 'new scene'],
    seeAlso: ['actions', 'ending-a-scene', 'scene-cost', 'transparency'],
  },
  {
    id: 'actions',
    category: 'playing',
    term: 'Taking an action',
    short: 'You write what your character does in your own words. There is no menu to pick from.',
    body: [
      'To act, describe what your character does. Anything you can say in a sentence, you can attempt — there is no list of allowed actions, and nothing you have to unlock before you can try it.',
      'What happens next: MythOS reads your action, works out which of your character\'s strengths it leans on, and settles the outcome before any prose exists. Your traits shift the odds. They never decide the result on their own, and they never rule an attempt out.',
      'Write what your character does and why, not what you want the outcome to be. "I put myself between her and the door" is something MythOS can resolve. "I win the argument" is a result, not an action, and gives it nothing to work with.',
      'Outcomes are not simply pass or fail. The common case is that you get what you wanted and something else comes with it — a cost, a complication, someone\'s attention. That middle band is where most of the story comes from.',
      'Phrasing something more confidently does not make it more likely to work. Detail helps only because it tells MythOS what you are actually doing.',
      'Once you submit an action you cannot take it back. Read it once before you send it.',
    ],
    aliases: ['submit action', 'your action', 'what do you do', 'act', 'take an action', 'fail', 'succeed'],
    seeAlso: ['scenes', 'transparency', 'harm', 'character-sheet'],
  },
  {
    id: 'ending-a-scene',
    category: 'playing',
    term: 'Ending a scene',
    short: 'Any player can end a scene, and ending it is what lets consequences settle.',
    body: [
      'When a scene has finished saying what it had to say, any player can end it. You do not need permission and you do not need to be the host.',
      'Ending is not just bookkeeping. It is when the scene\'s consequences are written into the world: what changed gets recorded, anything significant becomes something the world can remember and repeat, and the entries for the people and places involved are brought up to date.',
      'It is also when the scene is charged for. See "What a scene costs".',
      'A scene left open forever is a story stuck in one moment — nothing settles, and the record of what happened never catches up.',
    ],
    aliases: ['end scene', 'end the scene', 'close scene', 'wrap up'],
    seeAlso: ['scenes', 'scene-cost', 'memory'],
  },
  {
    id: 'scene-cost',
    category: 'playing',
    term: 'What a scene costs',
    short: 'Scenes cost real money, charged when the scene ends and split across whoever took part.',
    body: [
      'MythOS writes with a paid AI model, and that costs real money. You are charged for it.',
      'The charge lands when a scene ends, not while you are playing, and it is split across the players who took part in that scene — not billed to the host alone.',
      'What you pay is the real metered cost of the work that scene actually took, measured after the fact rather than estimated up front. A long scene with many exchanges costs more than a short one.',
      'Your balance is on your account page. A scene will not start work its participants cannot cover, so the failure mode is being told you are short — not a surprise charge.',
      'The world turn also does work while nobody is playing, and it is deliberately kept cheap: most of it is plain calculation with no AI involved at all.',
    ],
    aliases: ['cost', 'billing', 'balance', 'credits', 'charge', 'price', 'insufficient funds', 'pay', 'money'],
    seeAlso: ['ending-a-scene', 'scenes', 'world-turn'],
  },
  {
    id: 'combat',
    category: 'playing',
    term: 'Fights',
    short: 'There is no separate combat mode. A fight is a scene where the stakes are violence.',
    body: [
      'MythOS does not switch into a combat system. You describe what your character does exactly as you would anywhere else, and it resolves the same way.',
      'Everyone acts at once by default. You are not waiting for a turn unless your table has chosen to use the queue, and even then it never blocks you.',
      'When several people go for the same target or the same objective in one exchange, they are ranked by how well each of them actually did — not by who submitted first and not by the narrator picking a winner. The best outcome shapes what happens, and the others land around it.',
      'Position is narrative. Say where your character moves as part of what they do, and it is taken into account. If the scene has a map, it shows where everyone is, but the map is a picture of the fiction rather than a grid you move across.',
      'Getting hurt in a fight works like getting hurt anywhere: see "Getting hurt".',
    ],
    aliases: ['combat', 'fight', 'fighting', 'attack', 'battle', 'initiative', 'weapons', 'kill'],
    seeAlso: ['actions', 'harm', 'turn-order', 'items'],
  },
  {
    id: 'items',
    category: 'playing',
    term: 'Things you carry',
    short: 'Gear that does something mechanical, loot that is worth something, and a narrow set of things to buy.',
    body: [
      'Items are not just description. Something that protects you actually reduces what reaches you, something that hits harder actually does, and something that heals you heals a real amount when you use it — that is settled by the engine, not narrated into being.',
      'Loot has worth. What you find has a value and a rarity, and what the world hands out is kept within sane limits over a stretch of story so a generous scene cannot make you rich forever.',
      'There is no shop and no haggling. That is deliberate — a marketplace is a different game. There is a small, fixed set of sensible things money can be spent on, so gold can actually leave your purse through the engine rather than only through something the narrator said.',
      'Money matters mostly as leverage: what you can fund, what you can settle, what you can put up when someone wants something from you.',
    ],
    aliases: ['item', 'items', 'inventory', 'gear', 'equipment', 'loot', 'gold', 'money', 'buy', 'shop', 'weapon', 'armor', 'potion'],
    seeAlso: ['character-sheet', 'combat', 'debts', 'downtime'],
  },
  {
    id: 'origins',
    category: 'playing',
    term: 'Making a character',
    short: 'Name, pronouns, concept, description — and an origin that decides how much of this world you already understand.',
    body: [
      'You write who your character is: their name, pronouns, what they are, how they look, what they want. None of that is a stat block, and none of it is scored.',
      'Your traits are set from your concept, under whatever names your campaign gives them. Every campaign names its own, so your sheet speaks in your world\'s language rather than a rulebook\'s.',
      'The choice that matters mechanically is your origin — how familiar your character is with this world. A native recognises the shape of what exists here, even the parts they cannot do. A newcomer has heard of the obvious things. An outsider starts genuinely blank and learns everything from the fiction.',
      'Origin decides what you KNOW EXISTS, never what you can do. Nobody starts able to do anything unusual; ability only ever comes from play. Choosing native does not make you stronger, it makes your sheet less empty — you can see the outlines of things you have not learned.',
    ],
    aliases: ['create character', 'character creation', 'origin', 'native', 'newcomer', 'outsider', 'new character', 'concept'],
    seeAlso: ['character-sheet', 'advancement', 'abilities'],
  },
  {
    id: 'character-sheet',
    category: 'playing',
    term: 'Your character sheet',
    short: 'Half of it is yours to write. The other half is written by what happens to you.',
    body: [
      'Your sheet has two kinds of thing on it, and the difference is worth knowing.',
      'What you write: your name, pronouns, description, appearance, personality, backstory and goals. These are yours, and you can edit them whenever you like — your character\'s self-image is not something the world gets a vote on.',
      'What the world writes: your health, your conditions, what you have learned, what you can do and how well, who considers you in their debt, how factions regard you. You cannot edit these directly, and that is deliberate — a sheet you could type your own injuries out of would make consequences optional.',
      'Your traits are the handful of things your character is naturally better or worse at, under this campaign\'s own names for them. They tilt what you attempt. They never restrict it.',
      'Some of what the world tracks about you is not shown at all. That is not an oversight either. Knowing exactly where you stand would turn playing a person into managing a number.',
    ],
    aliases: ['character sheet', 'my character', 'traits', 'stats', 'sheet', 'edit character'],
    seeAlso: ['origins', 'harm', 'abilities', 'advancement'],
  },
  {
    id: 'abilities',
    category: 'playing',
    term: 'Abilities and knowledge',
    short: 'What your character can do and what they have worked out, discovered through play rather than picked from a list.',
    body: [
      'Your world has a set of systems in it — arts, disciplines, trades, whatever this setting calls them. They are arranged in domains, and some sit on top of others, so a deeper practice genuinely requires the groundwork beneath it.',
      'Your sheet shows only your relationship to that structure, not the structure itself. Something can be a blank outline you know exists, or something you can actually do. How well you can do it is described in words rather than as a figure.',
      'Knowing a thing exists and being able to do it are separate, always. You can learn of something far beyond you at any point — the fiction can show anyone anything. Doing it is what needs the groundwork.',
      'Separately from abilities, your sheet remembers things your character has worked out and confirmed: a name, a betrayal, where something is hidden. Those are facts, not skills; they do not have a level, they are simply known.',
      'The world will not hand you a deep art out of nowhere. If something appears that nothing led up to, you will learn that it exists and no more.',
    ],
    aliases: ['abilities', 'knowledge', 'abilities & knowledge', 'skills', 'powers', 'glimpsed', 'domain', 'what can i do', 'feats'],
    seeAlso: ['advancement', 'origins', 'what-you-know', 'corruption'],
  },
  {
    id: 'advancement',
    category: 'playing',
    term: 'Getting better at things',
    short: 'No experience points and no level-up screen. You improve at what you actually do.',
    body: [
      'There is no moment where you spend points. Advancement is a consequence of play, and it happens in three steps.',
      'First you learn something exists — the fiction shows it to you, and it appears on your sheet as an outline. Then you unlock it, which means the story gave you a real reason to be able to do it: you were taught, you worked it out, you survived something that left you changed. You begin at the bottom, able to do it badly.',
      'Then you get better, through two channels. Using it in a scene improves you slowly. Deliberately working on it during downtime improves you faster — that is what downtime is for. Both give less the better you already are, so the last stretch toward mastery is much harder than the first.',
      'There is a ceiling on how much ground you can gain in any single stretch of story, regardless of channel. That exists so grinding does not work: repeating the same training every scene will not outrun it, and you cannot rush a character to mastery in an afternoon.',
      'Depth needs foundation. Something built on other practices stays out of reach until you can genuinely do the things beneath it — all of them, not just one.',
      'Your traits move too, and much more slowly. Leaning on the same strength over a long stretch of story, in real situations with real outcomes, can improve it — but a trait is meant to be close to who your character fundamentally is, so this is rare by design rather than something to pursue.',
      'Characters also change from what they have lived through. Over a long campaign your character can develop something new that came directly out of their own history — written for them, out of what they actually did, rather than picked from a list every character shares. You do not opt into this and there is nothing to aim at; it is the campaign leaving a mark.',
      'MythOS notices what happened in the fiction and flags it; the amount it is worth is worked out by fixed rules, not by the narrator\'s judgement. This is why a scene where you did something remarkable moves you, and a scene where you said you trained does not.',
    ],
    aliases: ['level up', 'levelling', 'leveling', 'advancement', 'experience', 'xp', 'improve', 'train', 'training', 'get better', 'progress', 'mastery'],
    seeAlso: ['abilities', 'downtime', 'origins'],
  },
  {
    id: 'harm',
    category: 'playing',
    term: 'Getting hurt',
    short: 'Your health is on your sheet, and being badly hurt changes what the story does to you.',
    body: [
      'Your character can be hurt. Your health is shown on your sheet, and it is one of the few things about yourself you can read precisely — your own body is yours to know.',
      'Injury is a story fact, not just a lower number. A badly hurt character has worse options, and the narration treats them accordingly rather than describing them as if nothing had happened.',
      'Pushed far enough, a character can be taken out of a scene, and can face genuine danger of dying. That is resolved by the same machinery as everything else — settled before it is narrated, not decided by how the prose was going.',
      'Injuries heal. Time passing helps, and deliberately spending downtime recovering helps more.',
    ],
    aliases: ['health', 'harm', 'hurt', 'injury', 'wounded', 'damage', 'taken out', 'impaired', 'death', 'die'],
    seeAlso: ['character-sheet', 'downtime', 'actions'],
  },
  {
    id: 'downtime',
    category: 'playing',
    term: 'Downtime',
    short: 'The quiet stretches, where recovery and long work happen — and the only place some things can happen at all.',
    body: [
      'Not everything happens at knifepoint. Downtime is the space between tense scenes, where your character recovers, follows something up, trains, or works on something slow.',
      'A downtime activity has a real cost, taken when you commit to it — time, money, materials, whatever it asks for. You are not charged for a result you might get; you are paying to attempt it.',
      'It pays out when it completes, and what it earns lands on your sheet for real: what you healed, what you made, who you now know, how a faction regards you afterwards. It is not narration over an unchanged character.',
      'This is the fast lane for getting better at something. Deliberate work beats incidental practice — but the ceiling on how far you can move in one stretch of story still applies, so downtime accelerates progress rather than skipping it.',
      'The world keeps moving throughout. Taking your time is a real choice with a real price, measured in what everyone else did while you did.',
    ],
    aliases: ['downtime', 'rest', 'recover', 'between scenes', 'activity', 'activities', 'craft', 'project'],
    seeAlso: ['harm', 'advancement', 'world-turn', 'standing'],
  },
  {
    id: 'corruption',
    category: 'playing',
    term: 'Power at a cost',
    short: 'Some worlds price certain kinds of power. Where they do, it shows in the fiction and it opens doors.',
    body: [
      'Not every campaign has this. Where a world\'s story includes power that costs something — and many do not — your character can accumulate that cost.',
      'Every campaign names it in its own terms, because it belongs to that world\'s fiction rather than being a system bolted on top.',
      'You will not see it as a meter. It shows in how your character is written: what people notice, what the prose lingers on, what begins to change about you. That is the same principle as everything else here — the game tells you things in fiction, not in figures.',
      'It is also a key. Some of what this world can do is gated behind having paid that price, and stays genuinely out of reach otherwise. If the story offers you something on those terms and you have not paid, you will learn it exists and be unable to take it.',
    ],
    aliases: ['corruption', 'taint', 'power at a cost', 'marks', 'changed', 'price'],
    seeAlso: ['abilities', 'advancement', 'character-sheet'],
  },

  // ------------------------------------------------------------------ world
  {
    id: 'consequences',
    category: 'world',
    term: 'What your actions change',
    short: 'Scenes write back into the world. That is the whole point of the simulation being underneath.',
    body: [
      'What happens in a scene is not just narrated and forgotten. When a scene resolves, the changes it caused are applied to the world itself — a faction\'s position, how someone regards you, who holds what, what is now in motion.',
      'The narration does not get to invent those changes freely. Changes are proposed in a structured form and checked before anything is written: a change naming something that does not exist, or that breaks a rule the world runs on, is rejected rather than saved. This is why the story and the world state cannot drift apart.',
      'Consequences compound rather than resetting. Weakening a faction slows every plan it is pursuing. Making an enemy of someone means they act on it later, on their own schedule. Wrecking a place leaves it wrecked, and the people there respond to that.',
      'This runs in both directions: what the world did while you were away is waiting for you, and what you did is waiting for it.',
    ],
    aliases: ['consequences', 'consequence', 'does it matter', 'what changed', 'impact', 'effect', 'aftermath'],
    seeAlso: ['ending-a-scene', 'world-turn', 'factions', 'transparency'],
  },
  {
    id: 'time',
    category: 'world',
    term: 'Time and the calendar',
    short: 'Your world keeps its own calendar, and the season it is in has real effects.',
    body: [
      'The world advances in turns, and each turn is a step of in-world time as well as a step of simulation. You will see the current turn and the in-world date.',
      'Each campaign has its own calendar — its own month names, its own seasons, generated for that world rather than borrowed from ours.',
      'The season is not decoration. It shifts what weather is likely, changes how quickly groups rebuild what they have spent, and changes the pace at which some situations develop. A plan that would race ahead in one season crawls in another.',
      'This is why "come back later" is a real tactic and a real risk. Time passing is not neutral; it favours some people and not others.',
    ],
    aliases: ['time', 'calendar', 'date', 'season', 'seasons', 'turn number', 'winter', 'summer', 'month', 'how long'],
    seeAlso: ['world-turn', 'locations', 'threads'],
  },
  {
    id: 'legacy',
    category: 'world',
    term: 'When something important ends',
    short: 'A death or a collapse leaves a mark that fades slowly, not instantly.',
    body: [
      'When a significant figure dies, or a faction collapses, the world does not simply carry on as before. Whoever they belonged to is shaken by it, and losing a leader shakes it harder than losing a member.',
      'That mark is not permanent, but it does not vanish either. It fades over time as things settle, which means the period right after a loss is genuinely a different situation from the period before it — a weakened group is easier to push and less able to pursue what it wanted.',
      'This is what makes killing someone, or breaking an organisation, a strategic act rather than just a scene ending. It also means it can be done to you.',
      'A collapsed faction can leave a successor behind — smaller, carrying some of what it was. Whatever you had built with the original does not carry over.',
    ],
    aliases: ['death', 'died', 'collapse', 'destroyed', 'aftermath', 'wake', 'leader', 'succession'],
    seeAlso: ['factions', 'npcs', 'standing', 'wars'],
  },
  {
    id: 'world-turn',
    category: 'world',
    term: 'The world turn',
    short: 'On a schedule of its own, the whole world advances one step — with or without you.',
    body: [
      'MythOS runs the world on a regular schedule whether or not anyone logs in. A campaign nobody has opened in a week still moves.',
      'A turn is not one thing happening. It is a whole pass over the world: factions act on their goals and have those goals reassessed against their circumstances, major figures move through their own plans, weather and the seasons turn, places recover or decay, contested ground shifts, wars advance, populations move away from suffering places, debts come due, news travels, and every situation in motion advances.',
      'Almost all of that is plain calculation rather than AI invention, and it is deterministic: the same world in the same state produces the same turn. That is what makes it a simulation you can reason about rather than a random event generator. What the AI adds on top is the narration of it.',
      'Nothing here happens behind your back to punish you. It happens because the people in this world want things and keep wanting them while you are away.',
      'You will see the results as changes: something you were tracking has moved, someone you knew is somewhere else, a rumor is going around that was not going around before.',
    ],
    aliases: ['world turn', 'world tick', 'turn', 'the world moved', 'what changed', 'world events', 'offscreen'],
    seeAlso: ['threads', 'factions', 'rumors', 'locations'],
  },
  {
    id: 'threads',
    category: 'world',
    term: 'Threads',
    short: 'Situations in motion that fill up over time — and the main way the world commits to something happening.',
    body: [
      'A thread is a situation that is going somewhere: a faction closing on something it wants, a secret working toward the surface, a deadline approaching. Each shows how far along it is.',
      'They come from three places. Some are authored as part of the campaign\'s shape. Some are a faction pursuing an ambition — that is what a faction\'s plan looks like once it is actually underway. And some appear when two people who work together both decide to act at the same time, and start something jointly.',
      'How fast a thread fills is not random. It depends on who is driving it and how strong they currently are, on how tense the campaign is overall, and on the season. A well-resourced faction pushes its plans faster than a crumbling one. That is why weakening a faction slows everything it is working on, not just the thing you interfered with.',
      'When a thread completes, the thing it was building toward actually happens — and for a faction ambition that means a real outcome, won or lost, not just an announcement. Territory changes hands. Someone succeeds. The consequences are written into the world before anyone narrates them.',
      'You will not see every thread. Some are things nobody has told you about.',
    ],
    aliases: ['thread', 'threads', 'active threads', 'clock', 'clocks', 'countdown', 'progress', 'timer'],
    seeAlso: ['factions', 'world-turn', 'what-you-know', 'wars'],
  },
  {
    id: 'factions',
    category: 'world',
    term: 'Factions',
    short: 'Organized groups with goals, resources and rivals, re-deciding what to do every turn.',
    body: [
      'Factions are the groups that matter in your world — houses, crews, orders, companies, whatever your setting calls them. Each is tracked on what it has, how solid it is, and what it can bring to bear.',
      'Each one holds a goal, and acts on it every turn. What matters is that the goal is not fixed: the world reassesses it against the faction\'s actual circumstances. A faction that has been ground down stops expanding and starts consolidating; one that is thriving gets ambitious. This is why pressure works — you do not have to destroy a faction to change what it does, only to change its situation.',
      'Pursuing a goal turns into an ambition, and an ambition turns into a thread you can sometimes see filling. Beat it and the ambition fails; leave it and it lands.',
      'Factions deal with each other as much as with you. They ally, fall out, run up obligations, and go to war without you present. A faction can be destroyed outright — absorbed by a rival, or reduced to a remnant that carries on as something smaller — and new ones are founded out of the wreckage.',
      'A faction card describes how dangerous it is and how solid its position looks in plain terms rather than as figures. The narrator itself is never allowed to speak with more precision than that, and neither is your screen.',
      'If a player character ends up leading a faction, its direction is that player\'s call — the world stops re-deciding its goal and follows the one you set. Everything else about it keeps running.',
    ],
    aliases: ['faction', 'factions', 'house', 'organization', 'threat', 'stability', 'dormant', 'watchful', 'dangerous', 'dire', 'goal', 'ambition'],
    seeAlso: ['standing', 'threads', 'wars', 'world-turn'],
  },
  {
    id: 'standing',
    category: 'world',
    term: 'Standing',
    short: 'How a faction regards you, described the way a person would describe it.',
    body: [
      'Factions form opinions of you, and they are recorded per faction rather than as one reputation. You will see it written the way someone in the world would say it.',
      'You will not see a score. There is no bar to fill and no figure to optimize, because a relationship you can watch tick upward stops being a relationship and becomes a task.',
      'It moves from what you actually do — helping or crossing a faction in a scene, and what your downtime work earned you with them. It is not something you can address directly.',
      'What it is worth depends on who is offering it. Favour from a group barely holding together buys less than favour from one on the rise, and a faction that collapses takes whatever you built with it.',
      'Standing with groups you have not met, or that no longer exist, is simply not shown.',
    ],
    aliases: ['standing', 'reputation', 'honored by', 'regard', 'how they see me'],
    seeAlso: ['factions', 'debts', 'downtime'],
  },
  {
    id: 'debts',
    category: 'world',
    term: 'Debts and favours',
    short: 'Who owes whom, written as an obligation rather than a balance.',
    body: [
      'Obligations are real here and they are tracked. If someone considers you in their debt, you will be told so in those words.',
      'It is deliberately not shown as a ledger. An obligation is a piece of story with a person attached, and it behaves like one — it can be called in at an awkward moment, passed to someone else, or quietly forgotten by somebody who no longer needs you.',
      'Factions run up obligations to each other too, and those have teeth: a faction that cannot pay what it owes takes damage for it, and a group leaning on a failing debtor can be dragged down with them. Money troubles spread.',
      'Sometimes a circle of debt closes — three groups each owing the next — and it simply cancels out. Nobody pays, everyone walks away even, and a pressure you were counting on quietly disappears.',
    ],
    aliases: ['debt', 'debts', 'favour', 'favor', 'owes', 'in his debt', 'obligation', 'loan'],
    seeAlso: ['standing', 'factions'],
  },
  {
    id: 'locations',
    category: 'world',
    term: 'Locations',
    short: 'Places with a condition, weather, and an economy — all of which change.',
    body: [
      'Places are tracked, not just described. A location has a state — thriving, strained, falling apart — and that state moves with what happens there. War ravages a place; peace lets it recover.',
      'Weather is real, local, and predictable in the way real weather is: it drifts between related conditions rather than jumping wildly, and the season shapes it. It is worth reading before you plan anything that depends on it.',
      'Some places produce something worth having, and a faction that holds one gains from it — but only while it can actually move the goods. A rich location behind a cut supply line earns its owner nothing, which makes routes worth attacking and worth defending.',
      'Places can be contested without a war ever being declared. A contested location drifts toward whichever claimant is genuinely stronger until it either settles or changes hands.',
      'People react to all this. When somewhere becomes bad enough, named figures leave for somewhere healthier and the general population drifts the same way. A place you return to after a long absence is meant to tell you what happened while you were gone.',
    ],
    aliases: ['location', 'locations', 'place', 'weather', 'condition', 'crumbling', 'strained', 'steady', 'contested', 'supply', 'population'],
    seeAlso: ['world-turn', 'wars', 'factions'],
  },
  {
    id: 'npcs',
    category: 'world',
    term: 'People in the world',
    short: 'The characters MythOS plays. The important ones have lives that continue offscreen.',
    body: [
      'The people you meet are not scenery. The significant ones are simulated: they hold a goal, cycle through their own rhythm of watching, preparing, acting and resting, and move between the places they live and work.',
      'They have relationships with each other, not just with you, and those follow from the world\'s politics — colleagues are allies, and people in rival groups tend to inherit that stance personally. When two allies both decide to act at the same time, they start something together, and that becomes a real situation in motion.',
      'They remember you. What you did in front of someone shapes how they deal with you later, and they tell other people about it.',
      'What a person privately thinks of you is not shown to you, and is not given to the narrator either. You learn where you stand with someone the way you would anywhere else: from how they behave.',
      'They can die, leave, fall out with each other, or flee somewhere safer without you present. Minor figures stay in the background until the story brings them forward.',
    ],
    aliases: ['npc', 'npcs', 'characters', 'people', 'who is this', 'disposition'],
    seeAlso: ['rumors', 'standing', 'factions', 'what-you-know'],
  },
  {
    id: 'quests',
    category: 'world',
    term: 'Quests',
    short: 'Things you have taken on, attached to whoever asked — so it matters whether you deliver.',
    body: [
      'A quest is something your table picked up: a job, a promise, a problem somebody asked you to solve. They come out of the story rather than a quest board — somebody asks, you agree, and it appears.',
      'Every quest is tied to whoever commissioned it, as an actual person or faction rather than a name in a description. That is what makes the consequences real: failing or walking away from a job is something the specific person who gave it to you knows about, and can act on when you next stand in front of them.',
      'The Quests page keeps them so nobody has to remember what you agreed to three sessions ago.',
      'The world does not wait for you to get around to one. A situation you were asked to handle keeps developing, and it can resolve itself — or stop mattering — without you.',
    ],
    aliases: ['quest', 'quests', 'objective', 'mission', 'job', 'task', 'reward'],
    seeAlso: ['npcs', 'factions', 'world-turn', 'standing'],
  },
  {
    id: 'wars',
    category: 'world',
    term: 'Wars',
    short: 'Open conflict between factions, fought over real places, swinging back and forth on its own.',
    body: [
      'When factions stop manoeuvring and start fighting, it becomes a war with a front you can follow. Wars are fought over specific places, and holding one is a real thing that changes hands.',
      'A war has momentum that moves in both directions each turn, driven by what each side can actually bring — resources, strength, who holds what. It is described rather than scored. A war can stall, reverse, or run away from whoever started it.',
      'Push it far enough one way and it resolves: the ground is taken or the assault breaks. What follows — who holds what, who owes whom, which places were wrecked in the process — is usually where the next part of the story comes from.',
      'You can affect a war, but you are one party in it. It is not a puzzle waiting for you; it is other people pursuing something at each other\'s expense, and it will reach its own conclusion if you stay out.',
    ],
    aliases: ['war', 'wars', 'conflict', 'conflicts', 'battle', 'front', 'contested', 'momentum'],
    seeAlso: ['factions', 'locations', 'world-turn', 'threads'],
  },

  // ---------------------------------------------------------------- knowing
  {
    id: 'what-you-know',
    category: 'knowing',
    term: 'What you know',
    short: 'You see what your character could plausibly have learned — not everything that is true.',
    body: [
      'The world holds more than you are shown. Places you have not found, people you have not met, and plans nobody has told you about are simply absent from your view — not greyed out, not listed as locked. You cannot tell how much is missing, which is the honest version of not knowing.',
      'This is enforced where the information leaves the server, not by hiding things in the page. There is nothing to read in the source and nothing to open in a menu.',
      'What you saw yourself is solid. You were there.',
      'What reached you some other way is only as good as the route it took, and is marked differently. The difference matters.',
      'It applies to your own character too. Some of what the world tracks about you is deliberately withheld, so that playing a person does not become reading a dashboard.',
    ],
    aliases: ['fog of war', 'what i know', 'hidden', 'undiscovered', 'not discovered', 'why cant i see', 'secret'],
    seeAlso: ['rumors', 'threads', 'character-sheet', 'codex'],
  },
  {
    id: 'rumors',
    category: 'knowing',
    term: 'Rumors and secondhand news',
    short: 'News travels through distance and through people, takes time, and does not always arrive intact.',
    body: [
      'Something that happens far away does not appear in front of you the moment it happens. Word has to travel, and travelling takes time.',
      'It moves two ways at once, and arrives by whichever is faster. There is the map — how far the news physically has to go from where it happened to where you are. And there are people: word passes along who knows whom, so a well-connected figure can hear about something distant before their neighbour does. A world with no relationships on record falls back to distance alone.',
      'Anything you did not witness is marked as secondhand. That marking is a warning, not decoration: what you have been told may be incomplete, exaggerated, out of date, or simply wrong. People pass on what they believe, and they have their own reasons for what they choose to repeat.',
      'So a rumor tells you something real about whoever is spreading it even when its content is false.',
      'News does not chase you forever. Something that happened long ago and far away may simply never reach you.',
      'The way to be sure of something is to go and see it.',
    ],
    aliases: ['rumor', 'rumors', 'heard secondhand', 'rumor-grade', 'may be inaccurate', 'gossip', 'news', 'wrong'],
    seeAlso: ['what-you-know', 'npcs', 'world-turn'],
  },
  {
    id: 'codex',
    category: 'knowing',
    term: 'The Codex and the World view',
    short: 'Two different records: one for what is happening now, one for what has been written down.',
    body: [
      'The World view holds the living things — the people, factions, places and threads the world turn rewrites. What you see there is current, and it changes under you.',
      'The Codex holds written material: lore, items, quests, rumors, and anything your table has added. It is what you read rather than what you watch.',
      'Entries maintain themselves. When something significant happens to a person, faction or place, that entry is rewritten from what is currently true — so a faction that just lost a war does not still describe itself as ascendant. Routine churn deliberately does not trigger this: the weather changing every turn would bury the record in noise rather than filling it with signal.',
      'Rewriting is done from the facts, not by asking the AI to reimagine the entry, so an entry cannot drift away from what the simulation actually says. Entries keep a history of what changed and when, and link to each other — a person to their faction and the place they are, a faction to the ground it holds.',
      'What you can see in either follows the same rule as everything else: things you have not discovered are not there.',
    ],
    aliases: ['codex', 'wiki', 'world', 'lore', 'items', 'entries', 'encyclopedia', 'record'],
    seeAlso: ['what-you-know', 'memory', 'lore-import', 'world-turn'],
  },
  {
    id: 'memory',
    category: 'knowing',
    term: 'How the story remembers',
    short: 'Significant events are kept and resurfaced later, so the campaign does not forget its own past.',
    body: [
      'A long campaign produces more history than can be held in mind at once. MythOS keeps it, and pulls back the parts that are relevant when they become relevant.',
      'Not everything is kept at that level. Events are judged significant or routine, and the significant ones are what get remembered, written into the record, and made available to resurface later. That same judgement decides what updates a Codex entry, so there is one bar rather than several disagreeing ones.',
      'When a scene is being written, MythOS looks back for the past that bears on this moment and supplies it. That is why something you did long ago can be brought up by someone who was there, without you having to remind anyone.',
      'The Story Log is the readable version of this: the chronicle of what has already happened, assembled as you play.',
      'Old routine detail is eventually pruned. What was significant is what lasts, which is the same thing memory does.',
    ],
    aliases: ['memory', 'remember', 'history', 'story log', 'chronicle', 'past', 'recap'],
    seeAlso: ['codex', 'ending-a-scene', 'world-turn'],
  },

  // ------------------------------------------------------------------ table
  {
    id: 'turn-order',
    category: 'table',
    term: 'Turn order',
    short: 'A visible queue and timer. It never stops you from acting.',
    body: [
      'Play is freeform by default — anyone can act at any time, including in a fight.',
      'A table that wants more structure can turn on a turn queue for a scene. It shows whose turn it is and how long is left, and any player can turn it on or end it. There is no GM here to own it.',
      'The queue is advisory. Submitting an action is never blocked by it, and it never locks anyone out. It exists to help a table take turns fairly, not to gate the button.',
      'If a timer runs out, that is a nudge, not a forfeit.',
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
      'A campaign can set lines and veils before play: lines are things that will not appear at all, veils are things that happen off-screen. These are set up front and are worth agreeing on early rather than after something lands badly.',
      'The host can also set content warnings for the campaign so people know what they are joining, and a moderation level that constrains what the narration will produce.',
      'Any player can block another player, and report content to the host. Keeping the table comfortable is everyone\'s job, not one person\'s.',
    ],
    aliases: ['x-card', 'xcard', 'safety', 'lines and veils', 'content warning', 'block', 'report', 'uncomfortable', 'moderation'],
    seeAlso: ['chat', 'table-tools', 'invites'],
  },
  {
    id: 'chat',
    category: 'table',
    term: 'In-character and out-of-character chat',
    short: 'Two channels: one your character is speaking in, one you are.',
    body: [
      'In-character chat is your character talking. Out-of-character chat is you talking — checking a detail, sorting out scheduling, saying you need a minute.',
      'Keeping them separate matters. It lets the table settle something real without it becoming part of the story, and it lets your character say something you personally disagree with.',
      'Chat is between the real players in your campaign. It is not how you take an action — actions go through the story page, and only those are resolved.',
    ],
    aliases: ['chat', 'ic', 'ooc', 'in character', 'out of character', 'talk', 'message'],
    seeAlso: ['actions', 'safety'],
  },
  {
    id: 'table-tools',
    category: 'table',
    term: 'Notes, maps, and sharing',
    short: 'The supporting surfaces: your notes, scene maps, exports, and shareable recaps.',
    body: [
      'Notes are yours to keep, privately or shared with the table, for the things you want to remember — a name, a debt, a suspicion.',
      'Scenes can generate a map showing where everyone is. Position stays narrative: describe where your character moves as part of your action, and it is taken into account when the scene resolves.',
      'You can share a chronicle of your campaign, or a single moment from it, with people outside the table — it is gated behind a link you control rather than being public by default.',
      'You can export your campaign\'s data if you want your own copy of it.',
    ],
    aliases: ['notes', 'map', 'maps', 'export', 'share', 'recap', 'download'],
    seeAlso: ['memory', 'codex', 'invites'],
  },
  {
    id: 'split-party',
    category: 'table',
    term: 'Splitting up',
    short: 'Your table can run more than one scene at once, and each scene only knows about the people in it.',
    body: [
      'You do not all have to be in the same room. A table can have more than one scene going, with different people in each.',
      'A scene only sees its own participants. What another group is doing elsewhere is not fed into your scene, and your character does not react to things they were not present for — that is enforced where the data is assembled, not by everyone agreeing to roleplay ignorance.',
      'So splitting up genuinely splits what your characters know. Bringing information back to each other is something you have to do in the fiction, by meeting up and saying it.',
      'Everything else still applies: the world turns for everyone at once, and consequences from one group\'s scene are real for the other group whether or not they have heard about them yet.',
    ],
    aliases: ['split the party', 'split party', 'two scenes', 'multiple scenes', 'separate', 'group up', 'meanwhile'],
    seeAlso: ['scenes', 'what-you-know', 'rumors', 'invites'],
  },
  {
    id: 'notifications',
    category: 'table',
    term: 'Being told when something happens',
    short: 'Alerts for when it is your move, when someone mentions you, and when the world has moved.',
    body: [
      'Play is asynchronous. People act when they can, which means the thing that keeps a campaign alive is knowing when something has happened.',
      'You can be notified when a scene you are in advances, when it is your turn under a turn queue, when someone mentions you in chat, and when a note is shared with you.',
      'These can reach you as browser notifications on a device you have allowed, or by email. Which channels you use is your choice, per channel — you are not opted in to everything by joining a campaign.',
      'Notification settings live on your account, not per campaign.',
    ],
    aliases: ['notification', 'notifications', 'alerts', 'push', 'email', 'mention', 'mentioned', 'reminder'],
    seeAlso: ['turn-order', 'chat', 'invites'],
  },
  {
    id: 'friends',
    category: 'table',
    term: 'Friends',
    short: 'A list of people you play with, so starting the next campaign does not mean chasing links.',
    body: [
      'You can send someone a friend request and, once they accept, keep them on a list.',
      'It exists for the practical reason: finding the people you already play with, rather than digging out an invite link every time.',
      'Requests go both ways and have to be accepted. You can remove someone, and you can block someone inside a campaign independently of this — the two are separate, and blocking is the one that affects play.',
    ],
    aliases: ['friend', 'friends', 'friend request', 'add someone', 'contacts'],
    seeAlso: ['invites', 'safety', 'chat'],
  },
  {
    id: 'invites',
    category: 'table',
    term: 'Playing with other people',
    short: 'Share an invite link. There is no cap on party size.',
    body: [
      'A campaign is meant to be played with other people. Share an invite link from the Players panel and they join your table.',
      'There is no limit on how many people can be in a campaign.',
      'Everyone plays in the same scenes and the same world, and what one player does is visible to the others as part of the same story. Fog of war is per character, though — two players at the same table do not necessarily know the same things.',
      'The person who created the campaign administers it: settings, safety, and membership. Play itself is not theirs to control — anyone can start or end a scene.',
    ],
    aliases: ['invite', 'join', 'players', 'party', 'friends', 'multiplayer', 'host', 'admin'],
    seeAlso: ['chat', 'scenes', 'safety', 'what-you-know'],
  },

  // --------------------------------------------------------------- building
  {
    id: 'campaign-creation',
    category: 'building',
    term: 'Making a campaign',
    short: 'You give it a premise; it builds a whole working world before you play a word.',
    body: [
      'You pick a setting and give your campaign a title and a description. What comes back is not a blank map — it is a populated world, generated for you and reused nowhere else.',
      'Made at that moment: the factions, with what they want and what they are currently doing about it. The places, with their conditions. The people who matter, with their own goals. The structure of what can be learned in this world, arranged in domains with genuine prerequisites, including branches that only open under certain conditions. A calendar with this world\'s own seasons and month names. The rules this world runs on. And the vocabulary — what your character\'s traits are called here, and what the things you do are called — so the interface speaks your setting\'s language rather than a generic one.',
      'Some of that generation can fail without taking the campaign down. When a naming pass does not come back, you get sensible defaults instead of a broken campaign, which is why two campaigns in the same setting can differ in how much bespoke vocabulary they have.',
      'From then on it is the simulation\'s world, not a static backdrop. Everything created at the start is a starting position, and the world turn begins moving it immediately.',
      'The person who creates a campaign administers it and can adjust the world directly, but the simulation will keep steering things back toward what circumstances justify.',
    ],
    aliases: ['create campaign', 'new campaign', 'campaign creation', 'setting', 'universe', 'world generation', 'template', 'start'],
    seeAlso: ['lore-import', 'world-turn', 'factions', 'invites'],
  },
  {
    id: 'lore-import',
    category: 'building',
    term: 'Bringing your own canon',
    short: 'Import an existing world — pasted text, a page, or a whole wiki — and MythOS will play inside it.',
    body: [
      'If you already have a world, you do not have to let MythOS invent one. You can bring your canon in as pasted text, a single page, or by pointing it at an existing wiki and letting it crawl.',
      'What comes in is broken into passages and indexed so it can be searched by meaning rather than by keyword. When a scene needs to know something about your world, the relevant passages are found and supplied — so the narration works from your material instead of improvising over it.',
      'A large wiki is not imported wholesale. The most substantial pages are taken first, by how much they actually contain, rather than whatever happens to come first alphabetically. If the import had to stop short you are told so, rather than being left assuming everything made it.',
      'Imported canon also feeds world generation itself, so the factions and vocabulary you get can be drawn from your own material rather than invented alongside it.',
      'Importing is a job that runs in the background. A campaign is playable while it works, and you can watch its progress.',
    ],
    aliases: ['lore', 'import', 'wiki import', 'canon', 'my world', 'upload', 'mediawiki', 'source'],
    seeAlso: ['campaign-creation', 'codex', 'memory'],
  },

  {
    id: 'running-a-campaign',
    category: 'building',
    term: 'Running a campaign',
    short: 'If you made the campaign, you can reach in and change the world — and see what your change would do first.',
    body: [
      'Creating a campaign makes you its administrator. That is not the same as being a GM: there is no human running the story, and play itself is not yours to control. Anyone at the table can start or end a scene, and nothing waits on your approval.',
      'What it does give you is the world. You can edit the people, factions, places and situations directly, adjust safety settings and content limits, manage who is in the campaign, and add material of your own.',
      'Before changing something, you can ask what a change would do. Set a value to what you are considering and see the reasoning the simulation would use — which is a preview, not a commitment: nothing is written until you actually make the change.',
      'The simulation keeps running underneath you. Set a faction\'s goal by hand and the world will keep reassessing it against that faction\'s real circumstances, and steer it back toward whatever those circumstances justify. You are adjusting a world that has its own momentum, not scripting one that doesn\'t.',
    ],
    aliases: ['admin', 'gm', 'host', 'run a campaign', 'edit the world', 'settings', 'moderation', 'what if'],
    seeAlso: ['campaign-creation', 'invites', 'safety', 'factions'],
  },

  // ----------------------------------------------------------------- behind
  {
    id: 'transparency',
    category: 'behind',
    term: 'Behind the screen',
    short: 'An optional panel showing exactly how an outcome was decided and what it changed.',
    body: [
      'MythOS decides whether something worked before it writes what happened. The narration never mentions the machinery, because being told a story is the point.',
      'If you want to see it anyway, the panel is there. It is collapsed by default and opening it is entirely your choice — some players find that knowing breaks the spell, and some find that not knowing breaks their trust. Both are catered for.',
      'Inside, you can see what an action was measured against, what the result was, which band it landed in, and every change the scene made to the world. Nothing is hidden from you there; it is simply not pushed at you.',
      'The guarantee it exists to demonstrate: the outcome was settled before the prose was written. The narrator is describing a result, not choosing one. If a scene went badly, the panel will show you why, and the answer will not be that the model felt like it.',
    ],
    aliases: ['ai changes', 'transparency', 'roll', 'dice', 'why did that happen', 'receipt', 'how it was decided', 'proof'],
    seeAlso: ['actions', 'scenes', 'what-you-know'],
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
