-- Structured quests (README #45, #75).
--
-- objectiveKey: a stable per-campaign slug of the quest's name. Free-text
-- names drift as the fiction re-phrases them, so anything that refers to a
-- quest ("this opens after the ledger job") needs a handle that doesn't.
--
-- givenByNpcId / givenByFactionId: the quest-giver as a real entity rather
-- than a name string. givenBy stays authoritative for display — the same
-- free-text-plus-nullable-FK pattern as Character.currentLocation/locationId
-- — but without these, "the giver remembers you failed" is unrepresentable.
--
-- No backfill: existing quests keep a NULL key and NULL giver ids and behave
-- exactly as before. Keys and giver links are filled in as the fiction
-- touches each quest again.
ALTER TABLE "Quest" ADD COLUMN IF NOT EXISTS "objectiveKey" TEXT;
ALTER TABLE "Quest" ADD COLUMN IF NOT EXISTS "givenByNpcId" TEXT;
ALTER TABLE "Quest" ADD COLUMN IF NOT EXISTS "givenByFactionId" TEXT;

-- Partial-by-nature: Postgres treats NULLs as distinct, so every
-- un-keyed legacy quest coexists under this constraint without collision.
CREATE UNIQUE INDEX IF NOT EXISTS "Quest_campaignId_objectiveKey_key"
  ON "Quest"("campaignId", "objectiveKey");
CREATE INDEX IF NOT EXISTS "Quest_givenByNpcId_idx" ON "Quest"("givenByNpcId");
CREATE INDEX IF NOT EXISTS "Quest_givenByFactionId_idx" ON "Quest"("givenByFactionId");

-- SET NULL, not CASCADE: a dead NPC's quest still exists, it just no longer
-- has a living giver. Deleting the quest with them would erase party history.
ALTER TABLE "Quest"
  ADD CONSTRAINT "Quest_givenByNpcId_fkey"
  FOREIGN KEY ("givenByNpcId") REFERENCES "NPC"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Quest"
  ADD CONSTRAINT "Quest_givenByFactionId_fkey"
  FOREIGN KEY ("givenByFactionId") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
