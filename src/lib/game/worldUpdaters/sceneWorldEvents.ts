// src/lib/game/worldUpdaters/sceneWorldEvents.ts
// BUG-014 (#175): scene resolution's own domain appliers — stateUpdater.ts's
// per-exchange path, applying pc_changes/npc_changes/faction_changes/
// clock_changes/location_changes/quest_changes directly from the AI GM
// response — never fed WorldEvent, the durable structured-history table the
// world tick and consequence extraction already write through (see
// tick/worldEventLog.ts's persistWorldEvents). That meant the highest-
// frequency source of state change in the whole engine had no canonical
// event record at all — only console.log lines and whatever separately
// reached CampaignMemory/wiki sync through their own independent
// extraction logic.
//
// Each domain applier builds its own WorldChange[] list using the helper
// below (mirroring tick handlers' existing shape/convention exactly —
// same interface, same per-field granularity, not a generic object diff)
// and returns it; stateUpdater.ts collects every applier's list and calls
// persistWorldEvents once, tagged origin: 'sceneResolution' so it's
// distinguishable from a tick/consequence write to the same field.
//
// Scope: the 7 domain appliers wired directly into stateUpdater.ts.
// Sub-delegated writers (debts.ts, standing.ts, capabilities.ts) are a
// natural follow-up, not covered here. Deliberately skips
// Character.relationships — hidden from players by design (see its own
// schema comment) — logging it into a table with no equivalent fog-of-war
// gate would risk surfacing something meant to stay hidden.

import type { WorldChange, TickEntityType } from '../tick/types'

export function sceneWorldChange(
  campaignId: string,
  entityType: TickEntityType,
  entityId: string,
  entityName: string,
  field: string,
  previousValue: string | number,
  newValue: string | number,
  reason: string,
  importance: 'NORMAL' | 'MAJOR' = 'NORMAL'
): WorldChange {
  return {
    campaignId,
    entityType,
    entityId,
    entityName,
    field,
    previousValue,
    newValue,
    reason,
    // Unlike a tick's routine numeric nudges (mostly insignificant by
    // default), every one of these was deliberately narrated by the GM
    // this exchange — worth a history entry every time.
    significant: true,
    importance,
    origin: 'sceneResolution'
  }
}
