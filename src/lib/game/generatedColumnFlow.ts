// src/lib/game/generatedColumnFlow.ts
//
// The declared chain for each generated-once-then-frozen column.
//
// ## Why a manifest and not another heuristic
//
// Three defects in one week were the same shape, and none of them was
// "nobody wrote this column" — a heuristic can catch that, and
// columnWiring.test.ts does. These were subtler: the RIGHT field reaching the
// WRONG set of consumers.
//
//   - Campaign.advancementTrack was written by the backfill route and by
//     reseedWorld, and not by campaignCreation — the one path that creates
//     every campaign. Two writers existed, so "does anything write it" was
//     satisfied, and the feature was still inert for everyone.
//   - The same column reached the character sheet and not the snapshot
//     modal's route, so one surface rendered progression and the other showed
//     nothing.
//   - It reached the world-generation prompt and never the scene prompt, so
//     the GM resolving play was never told the ladder existed and could not
//     move anyone along it.
//
// No amount of pattern-matching separates "this consumer deliberately does
// not need the field" from "somebody forgot". That distinction is a design
// fact, so it has to be written down. This file is where it is written down,
// and the test beside it checks the writing against the code in BOTH
// directions — a declared file that stopped participating fails, and a file
// that started participating without being declared fails too.
//
// That second direction is the point. Adding a consumer forces you to open
// this file, which forces you to look at the whole chain, which is the moment
// somebody would have noticed campaignCreation missing from the list.
//
// ## Why only this family
//
// These five columns share the property that makes their failures invisible:
// NULL IS A MEANINGFUL VALUE. Null corruptionTheme means "this universe has
// no power-at-a-cost concept". Null advancementTrack means "no rank ladder".
// So a column left null because a link is missing is indistinguishable from
// one left null because the generator honestly said no — and the reassuring
// reading is the one people act on. A column whose absence throws does not
// need this.

/** What a file does with the column. */
export type FlowRole =
  /** Produces the value (an AI generator, or a deterministic builder). */
  | 'generate'
  /** Writes it when the owning row is first created. */
  | 'persist'
  /** Writes it for rows that predate the column. */
  | 'backfill'
  /** Puts it into a payload some other process or surface can see. */
  | 'deliver'
  /** Renders it, or feeds it to a prompt, or branches on it. */
  | 'consume'

/**
 * A file's part in the chain.
 *
 * `evidence` exists because file-level participation is not enough. When the
 * rank ladder was cut out of the scene-prompt request builder, that file still
 * mentioned `advancementTrack` in the surrounding code, so "does this file
 * participate" stayed true while the delivery link was gone — which is the
 * precise defect this manifest is for. Naming the payload key makes the link
 * itself checkable, not merely the file's involvement.
 *
 * Declare evidence wherever the thing being checked is a HANDOFF whose name
 * differs from the column's: a request field, a response key, a prompt tag.
 */
export type FlowEntry = FlowRole | { role: FlowRole; evidence: string }

export function roleOf(entry: FlowEntry): FlowRole {
  return typeof entry === 'string' ? entry : entry.role
}

export function evidenceOf(entry: FlowEntry): string | null {
  return typeof entry === 'string' ? null : entry.evidence
}

export interface DataFlow {
  /** Model.column, for messages. */
  fact: string
  /** The identifier as it appears in source. */
  symbol: string
  /** What breaks, concretely, when a link is missing. */
  why: string
  /** Every file that participates, and in what role. */
  roles: Record<string, FlowEntry>
  /**
   * Roles this column deliberately does not have, each with a reason.
   *
   * An empty stage is either a defect or a decision, and the only difference
   * is whether someone wrote down which. Silence defaults to defect.
   */
  waived?: Partial<Record<FlowRole, string>>
}

export const GENERATED_COLUMN_FLOWS: DataFlow[] = [
  {
    fact: 'Campaign.advancementTrack',
    symbol: 'advancementTrack',
    why:
      'Null renders no progression at all, which is also the correct output for a universe ' +
      'with no rank ladder. A missing link therefore looks exactly like an honest answer.',
    roles: {
      'src/lib/ai/worldExtras.ts': 'generate',
      'src/lib/game/campaignCreation.ts': { role: 'persist', evidence: 'advancementTrack: (worldExtras' },
      'src/app/api/campaigns/[id]/world-extras/route.ts': 'backfill',
      'src/lib/lore/reseedWorld.ts': 'backfill',
      'src/app/api/campaigns/[id]/characters/[characterId]/route.ts': { role: 'deliver', evidence: 'campaign: { advancementTrack' },
      'src/lib/ai/sceneResolutionRequest.ts': { role: 'deliver', evidence: 'advancement_track:' },
      'src/components/character/CharacterSheetDisplay.tsx': 'consume',
      'src/components/character/CharacterSnapshotModal.tsx': 'consume',
      'src/lib/game/worldUpdaters/characters.ts': 'consume',
      'src/lib/game/stateUpdater.ts': 'consume',
      'src/lib/game/characterCreation.ts': 'consume',
    },
  },
  {
    fact: 'Campaign.corruptionTheme',
    symbol: 'corruptionTheme',
    why: 'Null disables the corruption track entirely — indistinguishable from a broken link.',
    roles: {
      'src/lib/ai/worldExtras.ts': 'generate',
      'src/lib/game/campaignCreation.ts': { role: 'persist', evidence: 'corruptionTheme: (worldExtras' },
      'src/app/api/campaigns/[id]/world-extras/route.ts': 'backfill',
      'src/lib/lore/reseedWorld.ts': 'backfill',
      'src/app/campaigns/[id]/admin/page.tsx': 'consume',
      'src/lib/ai/sceneResolutionRequest.ts': { role: 'deliver', evidence: 'corruption_theme:' },
      'src/lib/game/stateUpdater.ts': 'deliver',
      'src/components/character/CharacterSheetDisplay.tsx': 'consume',
      'src/lib/game/resolution.ts': 'consume',
      'src/lib/game/worldUpdaters/bargainOffers.ts': 'consume',
      'src/lib/game/worldUpdaters/characters.ts': 'consume',
      'src/lib/game/worldUpdaters/quests.ts': 'consume',
    },
  },
  {
    fact: 'Campaign.statLabels',
    symbol: 'statLabels',
    why:
      'Null falls back to the engine default stat names, so a broken link degrades to generic ' +
      'labels rather than to nothing — visible, but only to someone who knows the universe.',
    roles: {
      'src/lib/ai/worldGenerator.ts': 'generate',
      'src/lib/game/campaignCreation.ts': 'persist',
      'src/lib/lore/reseedWorld.ts': 'backfill',
      'src/app/api/campaigns/[id]/world-extras/route.ts': 'deliver',
      'src/app/campaigns/[id]/page.tsx': 'deliver',
      'src/app/campaigns/[id]/characters/page.tsx': 'deliver',
      'src/app/help/[mechanicId]/page.tsx': 'consume',
      'src/components/character/CharacterSheetDisplay.tsx': 'consume',
      'src/components/forms/EnhancedCreateCharacterForm.tsx': 'consume',
      'src/lib/ai/moveFlavor.ts': 'consume',
      'src/lib/ai/worldExtras.ts': 'consume',
      'src/lib/tutorial/content/labels.ts': 'consume',
    },
  },
  {
    fact: 'Campaign.worldRules',
    symbol: 'worldRules',
    why:
      'Null means every semantic invariant runs unconditionally, exactly as before the column ' +
      'existed — safe, but a campaign that should have had tailored rules silently does not.',
    roles: {
      'src/lib/ai/worldRulesGenerator.ts': 'generate',
      'src/lib/game/campaignCreation.ts': 'persist',
      'src/lib/lore/reseedWorld.ts': 'backfill',
      'src/lib/game/integrity/worldRules.ts': 'consume',
      'src/lib/game/integrity/checks/factionLeadership.ts': 'consume',
      'src/lib/game/integrity/snapshot.ts': 'consume',
      'src/lib/game/integrity/types.ts': 'consume',
    },
    waived: {
      deliver:
        'Read directly from the campaign row by the integrity engine, which runs server-side ' +
        'in the same process — there is no payload boundary to cross.',
    },
  },
  {
    fact: 'Campaign.calendarConfig',
    symbol: 'calendarConfig',
    why:
      'Null leaves every date rendering on the generic fallback calendar, which reads as a ' +
      'plain style choice rather than as a missing feature.',
    roles: {
      'src/lib/game/campaignCreation.ts': 'persist',
      'src/lib/game/calendarBackfill.ts': 'backfill',
      'src/lib/ai/worldSummary.ts': 'deliver',
      'src/app/api/campaigns/[id]/logs/calendar/route.ts': 'deliver',
      'src/app/api/campaigns/[id]/clocks/[clockId]/reasoning/route.ts': 'deliver',
      'src/lib/game/sceneResolver.ts': 'consume',
      'src/lib/game/worldTick.ts': 'consume',
      'src/lib/game/tick/clockTick.ts': 'consume',
      'src/lib/game/tick/seasonTick.ts': 'consume',
    },
    waived: {
      generate:
        'Built deterministically in campaignCreation from the universe descriptor rather than ' +
        'by a named generator module, so no file references the column while producing it.',
    },
  },
]

/** Roles every flow must fill unless it waives them with a reason. */
export const REQUIRED_ROLES: FlowRole[] = ['generate', 'persist', 'backfill', 'deliver', 'consume']

export interface FlowViolation {
  fact: string
  problem: string
}

/**
 * Roles that are neither filled nor waived.
 *
 * A missing `persist` is the advancementTrack bug. A missing `backfill` means
 * every existing row is locked out forever. A missing `deliver` means a
 * consumer that renders nothing while looking healthy.
 */
export function findMissingRoles(flows: DataFlow[] = GENERATED_COLUMN_FLOWS): FlowViolation[] {
  const out: FlowViolation[] = []
  for (const flow of flows) {
    const filled = new Set(Object.values(flow.roles).map(roleOf))
    for (const role of REQUIRED_ROLES) {
      if (filled.has(role)) continue
      if (flow.waived?.[role]) continue
      out.push({
        fact: flow.fact,
        problem: `no file fills the "${role}" role, and it is not waived with a reason`,
      })
    }
  }
  return out
}

/** Waivers for a role that is in fact filled — the exception has gone stale. */
export function findStaleWaivers(flows: DataFlow[] = GENERATED_COLUMN_FLOWS): FlowViolation[] {
  const out: FlowViolation[] = []
  for (const flow of flows) {
    const filled = new Set(Object.values(flow.roles).map(roleOf))
    for (const role of Object.keys(flow.waived || {}) as FlowRole[]) {
      if (filled.has(role)) {
        out.push({ fact: flow.fact, problem: `waives "${role}" but a file now fills it` })
      }
    }
  }
  return out
}
