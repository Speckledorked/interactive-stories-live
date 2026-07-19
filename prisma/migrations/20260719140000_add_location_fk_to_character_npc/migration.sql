-- Character/NPC: a nullable Location foreign key alongside the existing
-- free-text currentLocation string (see README Known Bugs P1 — Location
-- stored as free text, not an FK). currentLocation stays the source of
-- truth the AI/creation forms write directly; locationId gives every
-- location-identity comparison (weather, split-party grouping) a stable
-- join key instead of ad-hoc string equality.

ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "NPC" ADD COLUMN IF NOT EXISTS "locationId" TEXT;

CREATE INDEX IF NOT EXISTS "Character_locationId_idx" ON "Character"("locationId");
CREATE INDEX IF NOT EXISTS "NPC_locationId_idx" ON "NPC"("locationId");

ALTER TABLE "Character" ADD CONSTRAINT "Character_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NPC" ADD CONSTRAINT "NPC_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One-time backfill: link existing rows whose currentLocation string
-- already matches a real Location row in the same campaign, using the
-- exact same identity (case-insensitive name, trimmed) Location's own
-- campaignId+name unique constraint already keys on. A currentLocation
-- string that never became a real Location row is left null here rather
-- than inventing one during a migration.
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
