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
