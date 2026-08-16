-- #374/#375/#376/#377: world-turn integrity.
--
-- Four related columns/indexes, all in service of one turn actually being
-- one turn: its own counter, an exclusive claim, replay identity for the
-- two tables a retry duplicates, and an index for the rotation sort key.

-- ---------------------------------------------------------------------------
-- #374: the simulation's own loop counter.
--
-- Backfilled from currentTurnNumber rather than left at 0. currentTurnNumber
-- counts scene resolutions, which is the wrong quantity, but it is a real
-- monotonic history for campaigns that have been played — starting those at
-- 0 would make every existing world event look like it happened "before"
-- everything already recorded, and informationTick's age arithmetic
-- (currentTurn - event.turnNumber) would go negative for the entire backlog.
-- Starting from currentTurnNumber keeps the existing WorldEvent.turnNumber
-- rows in the past where they belong. See docs/MIGRATIONS.md on backfills.
-- ---------------------------------------------------------------------------
ALTER TABLE "WorldMeta" ADD COLUMN IF NOT EXISTS "simulationTurn" INTEGER NOT NULL DEFAULT 0;
UPDATE "WorldMeta" SET "simulationTurn" = GREATEST("currentTurnNumber", 0) WHERE "simulationTurn" = 0;

-- ---------------------------------------------------------------------------
-- #376: world-turn lease. Null means "no run in flight".
-- ---------------------------------------------------------------------------
ALTER TABLE "WorldMeta" ADD COLUMN IF NOT EXISTS "worldTurnRunningSince" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- #377: replay identity.
--
-- Nullable with a plain UNIQUE index: Postgres treats NULLs as distinct, so
-- every pre-migration row keeps a NULL key and coexists. New writes supply a
-- deterministic key and collide with their own replay.
-- ---------------------------------------------------------------------------
ALTER TABLE "world_events" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "world_events_campaignId_dedupeKey_key"
  ON "world_events" ("campaignId", "dedupeKey");

ALTER TABLE "campaign_memories" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_memories_campaignId_dedupeKey_key"
  ON "campaign_memories" ("campaignId", "dedupeKey");

-- ---------------------------------------------------------------------------
-- #375: lastTickedAt is the rotation sort key for 11 capped queries per
-- tick. 20260815050000 added the columns and no index.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "Faction_campaignId_lastTickedAt_idx"
  ON "Faction" ("campaignId", "lastTickedAt");
CREATE INDEX IF NOT EXISTS "NPC_campaignId_lastTickedAt_idx"
  ON "NPC" ("campaignId", "lastTickedAt");

-- ---------------------------------------------------------------------------
-- #375: per-entity drift watermarks, replacing the campaign-level ones.
--
-- A campaign-level watermark plus a capped, ROTATING roster loses drift
-- permanently: the pass advanced the watermark past turn T after processing
-- only the subset that won that tick, so everyone else never received turn
-- T's drift and the watermark guaranteed they never would.
--
-- Backfilled from the campaign-level value rather than left NULL: NULL means
-- "never processed", which would make every existing faction/NPC re-derive
-- drift from its entire event history on the next tick — real, wrong,
-- self-inflicted state change on live campaigns. Seeding each entity with
-- what the campaign had already processed means the new per-entity window
-- starts exactly where the old global one stopped. See docs/MIGRATIONS.md.
-- ---------------------------------------------------------------------------
ALTER TABLE "Faction" ADD COLUMN IF NOT EXISTS "beliefDriftThroughTurn" INTEGER;
ALTER TABLE "NPC" ADD COLUMN IF NOT EXISTS "dispositionDriftThroughTurn" INTEGER;

UPDATE "Faction" f
   SET "beliefDriftThroughTurn" = wm."beliefDriftProcessedThroughTurn"
  FROM "WorldMeta" wm
 WHERE wm."campaignId" = f."campaignId"
   AND wm."beliefDriftProcessedThroughTurn" IS NOT NULL
   AND f."beliefDriftThroughTurn" IS NULL;

UPDATE "NPC" n
   SET "dispositionDriftThroughTurn" = wm."dispositionDriftProcessedThroughTurn"
  FROM "WorldMeta" wm
 WHERE wm."campaignId" = n."campaignId"
   AND wm."dispositionDriftProcessedThroughTurn" IS NOT NULL
   AND n."dispositionDriftThroughTurn" IS NULL;

-- ---------------------------------------------------------------------------
-- #386: capability provenance.
--
-- Default false, and NOT backfilled to anything else: every existing row
-- predates AI-minted nodes being distinguishable, and treating a
-- generator-authored node as narrated would newly gate capabilities players
-- already have. False is both the safe default and the accurate one for
-- everything that exists today.
-- ---------------------------------------------------------------------------
ALTER TABLE "CampaignCapability" ADD COLUMN IF NOT EXISTS "isNarrated" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- #392: consolidation archives instead of deleting.
--
-- No backfill possible or wanted: memories already deleted by past
-- consolidation runs are gone. Every surviving row is live (archivedAt NULL),
-- which is accurate.
-- ---------------------------------------------------------------------------
ALTER TABLE "campaign_memories" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "campaign_memories" ADD COLUMN IF NOT EXISTS "consolidatedIntoId" TEXT;
CREATE INDEX IF NOT EXISTS "campaign_memories_campaignId_archivedAt_idx"
  ON "campaign_memories" ("campaignId", "archivedAt");

-- ---------------------------------------------------------------------------
-- #378: backfill Location.resourceSlots.
--
-- This column is the input the ENTIRE logistics/supply/extraction subsystem
-- gates on (logisticsTick's extraction and route-creation passes both open
-- with `if (resourceSlots.length === 0) continue`), and it had zero writers
-- anywhere in the repository. Both passes therefore skipped 100% of rows in
-- every real campaign, on every tick, since the feature shipped.
--
-- Code now derives slots at every creation path (see game/resourceSlots.ts),
-- but new campaigns alone would leave every EXISTING one permanently inert —
-- exactly the "nullable-means-neutral, no backfill" pattern #380 is about.
-- The SQL below mirrors deriveResourceSlots' hints; a location matching no
-- hint gets 'grain', the same settlement default, because the failure mode
-- being fixed is a world where nothing produces anything.
-- ---------------------------------------------------------------------------
UPDATE "Location"
   SET "resourceSlots" =
     CASE
       WHEN COALESCE("locationType", '') || ' ' || COALESCE(name, '') || ' ' || COALESCE(description, '')
            ~* '(ruin|wasteland|wilds|wilderness|badlands|swamp|desert|tomb|crypt)' THEN ARRAY[]::text[]
       WHEN COALESCE("locationType", '') || ' ' || COALESCE(name, '') || ' ' || COALESCE(description, '')
            ~* '(mine|quarry|forge|foundry|smelt)' THEN ARRAY['ore']
       WHEN COALESCE("locationType", '') || ' ' || COALESCE(name, '') || ' ' || COALESCE(description, '')
            ~* '(farm|field|orchard|vineyard|granary|pasture)' THEN ARRAY['grain']
       WHEN COALESCE("locationType", '') || ' ' || COALESCE(name, '') || ' ' || COALESCE(description, '')
            ~* '(forest|wood|lumber|grove|timber)' THEN ARRAY['timber']
       WHEN COALESCE("locationType", '') || ' ' || COALESCE(name, '') || ' ' || COALESCE(description, '')
            ~* '(port|harbor|harbour|market|bazaar|caravan|trade|dock)' THEN ARRAY['trade']
       WHEN COALESCE("locationType", '') || ' ' || COALESCE(name, '') || ' ' || COALESCE(description, '')
            ~* '(librar|archive|academy|temple|monaster|scriptorium|college)' THEN ARRAY['lore']
       WHEN COALESCE("locationType", '') || ' ' || COALESCE(name, '') || ' ' || COALESCE(description, '')
            ~* '(city|capital)' THEN ARRAY['trade', 'grain']
       ELSE ARRAY['grain']
     END
 WHERE cardinality("resourceSlots") = 0;

-- ---------------------------------------------------------------------------
-- #379: backfill LocationAdjacency for campaigns with no world graph.
--
-- Its only writer was reseedWorld.ts, reachable only through the
-- lore-import pipeline, so every campaign created any other way had an
-- EMPTY table while five subsystems read it — informationTick (hop distance
-- for latency and distortion), npcTick (work-location selection),
-- migrationTick, logisticsTick (supply routes) and ambitionResolution. All
-- five fall back silently, so the absence was invisible.
--
-- Mirrors buildDefaultAdjacency: a connected ring plus chords at stride 3.
-- A ring (not a full mesh) because collapsing every distance to one hop
-- would make informationTick's latency model constant and its distortion
-- tiers unreachable; chords (not a bare chain) so the diameter stays small
-- enough for news to cross.
--
-- Only campaigns with NO edges at all are touched — an authored graph from
-- imported lore is never overwritten or extended by this.
-- ---------------------------------------------------------------------------
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
  -- Ring: every location to the next, wrapping.
  SELECT a."campaignId", a.id AS id_a, b.id AS id_b, 1 AS distance
    FROM ordered a
    JOIN ordered b ON b."campaignId" = a."campaignId" AND b.idx = (a.idx + 1) % a.n
   WHERE a.n >= 2 AND a.id <> b.id
  UNION
  -- Chords, only once the ring is long enough for them to shorten anything.
  SELECT a."campaignId", a.id AS id_a, b.id AS id_b, 2 AS distance
    FROM ordered a
    JOIN ordered b ON b."campaignId" = a."campaignId" AND b.idx = (a.idx + 3) % a.n
   WHERE a.n > 4 AND a.id <> b.id
)
INSERT INTO "LocationAdjacency" (id, "campaignId", "locationAId", "locationBId", distance, "createdAt")
SELECT
  gen_random_uuid(),
  "campaignId",
  -- Canonical ordering: locationAId is always the lexicographically
  -- smaller id, matching the model's @@unique convention.
  LEAST(id_a, id_b),
  GREATEST(id_a, id_b),
  MIN(distance),
  NOW()
FROM pairs
GROUP BY "campaignId", LEAST(id_a, id_b), GREATEST(id_a, id_b)
ON CONFLICT ("locationAId", "locationBId") DO NOTHING;

-- ---------------------------------------------------------------------------
-- #410: make the entity caps observable.
--
-- Null means "no tick has reported yet", which is accurate for every
-- existing row — there is nothing to backfill, because the information was
-- never recorded anywhere to recover.
-- ---------------------------------------------------------------------------
ALTER TABLE "WorldMeta" ADD COLUMN IF NOT EXISTS "lastTickCapReport" JSONB;
