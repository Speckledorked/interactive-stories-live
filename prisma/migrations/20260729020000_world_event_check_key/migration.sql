-- Distinguishes an Integrity Engine repair from an ordinary tick/consequence
-- write to the same field on the same entity — needed so escalation
-- (integrity/escalation.ts) can tell "this got repaired again" apart from
-- "this field just changed again in play", which would otherwise look
-- identical (e.g. Character.relationships changes constantly from normal
-- scene play, not just from repairs).
ALTER TABLE "world_events" ADD COLUMN "checkKey" TEXT;
