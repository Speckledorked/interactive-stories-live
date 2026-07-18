-- Drop the dead TurnOrder model (World Sim depth audit, July 2026): zero
-- live references anywhere in the codebase outside the schema itself. Not
-- to be confused with TurnTracker (kept), which is the live turn-tracking
-- model actually used by lib/notifications/turn-tracker.ts.
--
-- No migration ever created this table (it was introduced without a
-- tracked migration), so this uses IF EXISTS to be safe whether or not a
-- given database actually has it.

-- DropForeignKey (defensive — implicit m:n join table, if it exists)
DROP TABLE IF EXISTS "_CharacterToTurnOrder";

-- DropTable
DROP TABLE IF EXISTS "TurnOrder";
