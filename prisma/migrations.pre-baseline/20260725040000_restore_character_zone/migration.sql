-- Abstract range bands (README #2, #43, #85).
--
-- These columns were dropped in 20260724233000_drop_character_zone because
-- the ZoneManager that backed them had no consumers — nothing set a zone
-- and nothing read one. They return with a consumer: computeMechanics now
-- applies rangeModifier(zone, engagement) to every classified action, so a
-- character's position lands in the roll total and on the DiceRoll receipt.
--
-- No backfill. NULL resolves to DEFAULT_ZONE ('near'), the one band that
-- modifies nothing, so every existing character starts unaffected.
ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "currentZone" TEXT;
ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "zoneMetadata" JSONB;
