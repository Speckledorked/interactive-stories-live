-- REPAIR: replay the tail of 20260816090000_world_turn_integrity, which
-- production never ran.
--
-- ## What happened
--
-- 20260816090000_world_turn_integrity was applied to production on
-- 2026-08-16T06:50:45. Three later pull requests then APPENDED statements to
-- that same already-applied migration file instead of adding new migration
-- files of their own.
--
-- `prisma migrate deploy` keys on the migration NAME. Once a name is recorded
-- in _prisma_migrations it is never executed again, and deploy does not fail
-- on a checksum mismatch — it simply says "All migrations have been
-- successfully applied" and moves on. So every statement appended after
-- 06:50 on 2026-08-16 ran in CI (which builds a fresh database from the
-- current files) and never ran in production.
--
-- Proven rather than inferred: production's stored checksum for that
-- migration is 24bc433d…, which is the sha256 of the file as it stood at
-- commit fabaace — its original version. The file on disk today hashes to
-- efef9e30….
--
-- ## What production was missing
--
-- Verified directly against the production database, not assumed:
--
--   CampaignCapability.isNarrated                      absent
--   campaign_memories.archivedAt                       absent
--   campaign_memories.consolidatedIntoId               absent
--   campaign_memories_campaignId_archivedAt_idx        absent
--   WorldMeta.lastTickCapReport                        absent
--
-- The user-visible symptom was every campaign detail page failing:
-- /api/campaigns/[id] selects WorldMeta, so Prisma emitted a column list
-- including lastTickCapReport and Postgres rejected the query with P2022.
-- 12 occurrences before this was found. archivedAt is #442's retention work
-- and consolidatedIntoId is memory consolidation, so those subsystems were
-- reading against columns that were not there either.
--
-- ## What is deliberately NOT replayed
--
-- The appended tail also contained two backfills. Only one is replayed here.
--
-- The LocationAdjacency backfill IS replayed: only 2 of 8 campaigns in
-- production have any adjacency rows, so six campaigns have no location
-- graph at all, which is exactly what that backfill existed to fix. It is
-- safe to re-run — the CTE is guarded per campaign by
-- `WHERE NOT EXISTS (… adjacency for that campaign)` and the insert ends in
-- ON CONFLICT DO NOTHING, so campaigns that already have a graph are
-- untouched.
--
-- The Location.resourceSlots backfill is NOT replayed. It has been
-- superseded by 20260817060000_resource_slots_precedence, which DID apply to
-- production (checksum matches) and derives slots from a better set of type
-- hints. Four locations still hold an empty resourceSlots array, and under
-- the newer rules that is correct — they are the ruins/wilds cases. Replaying
-- the older, coarser CASE would match those same four rows
-- (`WHERE cardinality = 0`) and could stamp ELSE ARRAY['grain'] onto a ruin.
-- Restoring a superseded rule on top of the rule that replaced it would be a
-- second bug, not a repair.
--
-- ## Idempotent throughout
--
-- Every statement below is IF NOT EXISTS or ON CONFLICT DO NOTHING, so this
-- is a no-op anywhere the original tail already ran — CI, local databases,
-- and any environment built from the current migration files.

-- #439: capability narration flag.
ALTER TABLE "CampaignCapability" ADD COLUMN IF NOT EXISTS "isNarrated" BOOLEAN NOT NULL DEFAULT false;

-- #442: retention archives rather than deletes, and consolidation records
-- which memory absorbed which.
ALTER TABLE "campaign_memories" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "campaign_memories" ADD COLUMN IF NOT EXISTS "consolidatedIntoId" TEXT;

CREATE INDEX IF NOT EXISTS "campaign_memories_campaignId_archivedAt_idx"
  ON "campaign_memories" ("campaignId", "archivedAt");

-- #410: make the entity caps observable. Null means "no tick has reported
-- yet", which is accurate for every existing row.
ALTER TABLE "WorldMeta" ADD COLUMN IF NOT EXISTS "lastTickCapReport" JSONB;

-- The location graph, for campaigns that have none. Verbatim from the tail
-- that never ran, including its per-campaign guard.
WITH ordered AS (
  SELECT
    l."campaignId",
    l.id,
    ROW_NUMBER() OVER (PARTITION BY l."campaignId" ORDER BY l.id) - 1 AS idx,
    COUNT(*) OVER (PARTITION BY l."campaignId") AS n
  FROM "Location" l
  WHERE NOT EXISTS (
    SELECT 1 FROM "LocationAdjacency" a WHERE a."campaignId" = l."campaignId"
  )
),
pairs AS (
  SELECT a."campaignId", a.id AS id_a, b.id AS id_b, 1 AS distance
    FROM ordered a
    JOIN ordered b ON b."campaignId" = a."campaignId" AND b.idx = (a.idx + 1) % a.n
   WHERE a.n >= 2 AND a.id <> b.id
  UNION
  SELECT a."campaignId", a.id AS id_a, b.id AS id_b, 2 AS distance
    FROM ordered a
    JOIN ordered b ON b."campaignId" = a."campaignId" AND b.idx = (a.idx + 3) % a.n
   WHERE a.n > 4 AND a.id <> b.id
)
INSERT INTO "LocationAdjacency" (id, "campaignId", "locationAId", "locationBId", distance, "createdAt")
SELECT
  gen_random_uuid(),
  "campaignId",
  LEAST(id_a, id_b),
  GREATEST(id_a, id_b),
  MIN(distance),
  NOW()
FROM pairs
GROUP BY "campaignId", LEAST(id_a, id_b), GREATEST(id_a, id_b)
ON CONFLICT ("locationAId", "locationBId") DO NOTHING;
