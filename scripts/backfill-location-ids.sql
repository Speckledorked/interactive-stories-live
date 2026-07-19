-- One-time backfill for Character.locationId / NPC.locationId.
--
-- This deployment's build command runs `prisma db push` (see
-- vercel.json), not `prisma migrate deploy` — db push diffs
-- schema.prisma straight onto the live database and never executes
-- migration SQL files, so the backfill in
-- prisma/migrations/20260719140000_add_location_fk_to_character_npc
-- never actually runs in production. The locationId/location columns
-- themselves DO get created fine (db push picks those up from
-- schema.prisma directly) — only this data backfill needs to be run
-- by hand, once, after that schema change has been deployed.
--
-- Safe to run multiple times (only touches rows where locationId IS
-- NULL) and safe to run before or after normal play resumes — nothing
-- reads locationId as required; every consumer falls back to the
-- existing currentLocation string match when it's null. Existing rows
-- left null here simply self-populate the next time that character/NPC
-- moves (see lib/game/worldUpdaters/locations.ts's
-- resolveOrCreateLocationId).
--
-- Usage: psql "$DATABASE_URL" -f scripts/backfill-location-ids.sql

UPDATE "Character" c
SET "locationId" = l."id"
FROM "Location" l
WHERE c."campaignId" = l."campaignId"
  AND c."currentLocation" IS NOT NULL
  AND lower(trim(c."currentLocation")) = lower(l."name")
  AND c."locationId" IS NULL;

UPDATE "NPC" n
SET "locationId" = l."id"
FROM "Location" l
WHERE n."campaignId" = l."campaignId"
  AND n."currentLocation" IS NOT NULL
  AND lower(trim(n."currentLocation")) = lower(l."name")
  AND n."locationId" IS NULL;
