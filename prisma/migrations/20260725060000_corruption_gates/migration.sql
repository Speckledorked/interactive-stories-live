-- Corruption as a real content gate (README #83).
--
-- min = only the marked may pass; max = the marked are turned away. Both
-- NULL (the default, and every existing row) means ungated, so nothing that
-- exists today changes behavior.
--
-- Enforced at a BOUNDARY only, never re-evaluated against state a character
-- already holds: marks are irreversible and capped at one per scene, so a
-- retroactive gate would be a one-way trap — locked inside a room, or
-- holding a quest that can never be progressed. Locations gate on entry,
-- quests on acquisition, NPCs on leverage. See lib/game/corruptionGates.ts.
--
-- No CHECK constraint on the 0-5 range: corruptionGates.ts clamps on read,
-- so an out-of-range value degrades to the nearest valid bound rather than
-- failing a write mid-transaction and taking a whole scene resolution down.
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "minCorruption" INTEGER;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "maxCorruption" INTEGER;

ALTER TABLE "Quest" ADD COLUMN IF NOT EXISTS "minCorruption" INTEGER;
ALTER TABLE "Quest" ADD COLUMN IF NOT EXISTS "maxCorruption" INTEGER;

ALTER TABLE "NPC" ADD COLUMN IF NOT EXISTS "minCorruption" INTEGER;
ALTER TABLE "NPC" ADD COLUMN IF NOT EXISTS "maxCorruption" INTEGER;
