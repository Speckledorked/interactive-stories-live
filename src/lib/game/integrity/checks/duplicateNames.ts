// src/lib/game/integrity/checks/duplicateNames.ts
// NPC/Faction/Quest have no DB uniqueness on (campaignId, name), despite all
// three being matched BY NAME by the AI write path (entityResolution.ts) —
// Location is the only world entity with @@unique([campaignId, name]).
// A duplicate name doesn't just look messy: resolveEntityByNameOrId treats
// two same-named rows as 'ambiguous' and every applier skips ambiguous
// matches rather than guessing, so a duplicate silently makes that entity
// unreachable by name from then on.
//
// Detect-only, deliberately: which of two same-named rows is "the real one"
// (and what to do with whatever state the other accumulated) is a judgment
// call, not a mechanical fix. See integrity/types.ts's RepairFn — returning
// null here is the documented "flagged but not auto-repairable" case.

import { normalizeEntityName } from '../../entityResolution'
import { IntegrityCheck, IntegritySnapshot, Violation } from '../types'

function findDuplicates(
  entities: Array<{ id: string; name: string }>,
  checkKey: string,
  entityType: Violation['entityType']
): Violation[] {
  const byName = new Map<string, Array<{ id: string; name: string }>>()
  for (const entity of entities) {
    const key = normalizeEntityName(entity.name)
    if (!key) continue
    const group = byName.get(key) ?? []
    group.push(entity)
    byName.set(key, group)
  }

  const violations: Violation[] = []
  for (const group of byName.values()) {
    if (group.length < 2) continue
    for (const entity of group) {
      violations.push({
        checkKey,
        entityType,
        entityId: entity.id,
        entityName: entity.name,
        description: `${group.length} entities in this campaign are named "${entity.name}" — the AI write path resolves by name and treats this as ambiguous, so none of them are reachable by name anymore`,
      })
    }
  }
  return violations
}

export const noDuplicateNpcNames: IntegrityCheck = {
  key: 'npc.name.unique',
  description: 'No two NPCs in a campaign should share a name',
  run: (snapshot: IntegritySnapshot) => findDuplicates(snapshot.npcs, 'npc.name.unique', 'NPC'),
}

export const noDuplicateFactionNames: IntegrityCheck = {
  key: 'faction.name.unique',
  description: 'No two Factions in a campaign should share a name',
  run: (snapshot: IntegritySnapshot) => findDuplicates(snapshot.factions, 'faction.name.unique', 'FACTION'),
}

export const noDuplicateQuestNames: IntegrityCheck = {
  key: 'quest.name.unique',
  description: 'No two Quests in a campaign should share a name',
  run: (snapshot: IntegritySnapshot) => findDuplicates(snapshot.quests, 'quest.name.unique', 'QUEST'),
}

export const DUPLICATE_NAME_CHECKS: IntegrityCheck[] = [
  noDuplicateNpcNames,
  noDuplicateFactionNames,
  noDuplicateQuestNames,
]
