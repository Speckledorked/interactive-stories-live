// src/lib/pbta-moves.ts
// Core PbtA move definitions and mechanics

export interface PbtAMove {
  name: string
  trigger: string
  description: string
  rollType?: string // e.g., "roll+cool", "roll+hard", null for no roll
  outcomes: {
    strongHit?: string // 10+
    weakHit?: string   // 7-9
    miss?: string      // 6-
  }
  category: 'basic' | 'special' | 'peripheral' | 'custom'
}

// Basic Moves (Apocalypse World inspired, but generic)
export const BASIC_MOVES: PbtAMove[] = [
  {
    name: "Act Under Fire",
    trigger: "When you do something under fire or follow through despite opposition",
    description: "Roll+cool. On a 10+, you do it. On a 7-9, you flinch, hesitate, or stall: the GM can offer you a worse outcome, a hard bargain, or an ugly choice.",
    rollType: "roll+cool",
    outcomes: {
      strongHit: "You do it, no problem.",
      weakHit: "You do it, but there's a complication or cost.",
      miss: "Things go badly. Brace yourself."
    },
    category: 'basic'
  },
  {
    name: "Go Aggro",
    trigger: "When you use violence or the threat of violence to make someone do what you want",
    description: "Roll+hard. On a 10+, they have to choose: force your hand or do what you want. On a 7-9, they can choose from additional options.",
    rollType: "roll+hard",
    outcomes: {
      strongHit: "They must give in or force your hand.",
      weakHit: "They choose: give in, force your hand, or offer something they think you want.",
      miss: "They turn the tables on you."
    },
    category: 'basic'
  },
  {
    name: "Seduce or Manipulate",
    trigger: "When you try to seduce, manipulate, or bluff someone",
    description: "Roll+hot. On a 10+, they'll do what you want if you promise them something. On a 7-9, they'll do it, but need something concrete first.",
    rollType: "roll+hot",
    outcomes: {
      strongHit: "They'll do it for a promise.",
      weakHit: "They need concrete assurance or payment first.",
      miss: "Your attempt backfires spectacularly."
    },
    category: 'basic'
  },
  {
    name: "Read a Situation",
    trigger: "When you assess a charged situation",
    description: "Roll+sharp. On a 10+, ask 3 questions. On a 7-9, ask 1. Take +1 when acting on answers.",
    rollType: "roll+sharp",
    outcomes: {
      strongHit: "Ask 3 questions from the list. Take +1 forward when acting on the answers.",
      weakHit: "Ask 1 question from the list. Take +1 forward when acting on the answer.",
      miss: "You misread the situation dangerously."
    },
    category: 'basic'
  },
  {
    name: "Read a Person",
    trigger: "When you study someone during a charged interaction",
    description: "Roll+sharp. On a 10+, ask 3 questions. On a 7-9, ask 1. They must answer truthfully.",
    rollType: "roll+sharp",
    outcomes: {
      strongHit: "Ask 3 questions about them. Take +1 forward when acting on the answers.",
      weakHit: "Ask 1 question about them. Take +1 forward when acting on the answer.",
      miss: "You reveal more than you learn."
    },
    category: 'basic'
  },
  {
    name: "Open Your Brain",
    trigger: "When you open your brain to the world's psychic maelstrom",
    description: "Roll+weird. On a 10+, the GM tells you something new and interesting. On a 7-9, the information comes at a cost.",
    rollType: "roll+weird",
    outcomes: {
      strongHit: "You receive clear and useful insight.",
      weakHit: "The vision is true but costly, partial, or disturbing.",
      miss: "You've opened yourself to something dangerous."
    },
    category: 'basic'
  },
  {
    name: "Help or Interfere",
    trigger: "When you help or interfere with someone",
    description: "Roll+Hx (relationship). On a 10+, they take +2 or -2 to their roll. On a 7-9, you also expose yourself to risk.",
    rollType: "roll+bond",
    outcomes: {
      strongHit: "They take +2 (help) or -2 (interfere) to their roll.",
      weakHit: "They take +1 (help) or -1 (interfere), but you're exposed to danger.",
      miss: "You make things worse for everyone."
    },
    category: 'basic'
  }
]

// Peripheral Moves (happen automatically)
export const PERIPHERAL_MOVES: PbtAMove[] = [
  {
    name: "Take Harm",
    trigger: "When you take harm",
    description: "Mark harm on your sheet. At 3+ harm, roll+harm. On a 10+, choose 1 from a bad list. On a 7-9, the GM chooses 1.",
    rollType: "roll+harm",
    outcomes: {
      strongHit: "You choose how you're taken out of action.",
      weakHit: "The GM chooses how you're hurt.",
      miss: "You take it like a champ and keep going."
    },
    category: 'peripheral'
  },
  {
    name: "End of Session",
    trigger: "At the end of each session",
    description: "Mark XP if you hit your highlighted stats. Discuss what happened and what's coming.",
    outcomes: {},
    category: 'peripheral'
  }
]

// Stats for PbtA characters
export const PBTA_STATS = {
  cool: "Cool - keeping your head under pressure",
  hard: "Hard - aggressive and violent capability",
  hot: "Hot - charm, manipulation, and social power",
  sharp: "Sharp - perception, wit, and intellect",
  weird: "Weird - connection to the strange and psychic"
}

// Calculate roll outcome based on PbtA rules
export function calculateOutcome(total: number): 'strongHit' | 'weakHit' | 'miss' {
  if (total >= 10) return 'strongHit'
  if (total >= 7) return 'weakHit'
  return 'miss'
}

// Format outcome text
export function formatOutcome(outcome: 'strongHit' | 'weakHit' | 'miss'): string {
  switch (outcome) {
    case 'strongHit':
      return '💪 Strong Hit (10+)'
    case 'weakHit':
      return '⚡ Weak Hit (7-9)'
    case 'miss':
      return '💀 Miss (6-)'
  }
}

// Get modifier name from stat
export function getStatName(stat: string): string {
  const statMap: Record<string, string> = {
    'cool': 'Cool',
    'hard': 'Hard',
    'hot': 'Hot',
    'sharp': 'Sharp',
    'weird': 'Weird',
    'bond': 'Bond',
    'harm': 'Harm'
  }
  return statMap[stat] || stat
}
