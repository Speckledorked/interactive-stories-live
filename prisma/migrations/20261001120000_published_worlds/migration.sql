-- #490: publishable worlds.
--
-- Templates were three hard-coded entries in a TypeScript file. For a
-- product whose whole shape is user-generated worlds there was no
-- user-generated loop: every campaign started from zero, alone, and nothing
-- a player made could be a starting point for anyone else.
--
-- A published world is a snapshot of a world DEFINITION — factions, the
-- capability scaffold, stat labels, the calendar, world rules, archetypes,
-- the opening premise. Never a campaign's play history: scenes, characters,
-- messages and rolls are somebody's game, the chronicle share link already
-- exists for reading those, and forking into a stranger's transcript is
-- both the wrong feature and a privacy problem.
CREATE TABLE "published_worlds" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    -- Nullable, ON DELETE SET NULL: a published world outlives its source,
    -- or every fork would break the day its author deleted their own game.
    "sourceCampaignId" TEXT,
    "publishedBy" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "universe" TEXT NOT NULL,
    -- Exactly the bundle campaign creation's two generation stages produce,
    -- so a fork replays the ordinary creation path with the model calls
    -- skipped rather than through a second seeding implementation.
    "snapshot" JSONB NOT NULL,
    -- Hidden from the directory without being deleted, so existing forks
    -- and links keep working and the author can relist.
    "isListed" BOOLEAN NOT NULL DEFAULT true,
    "forkCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "published_worlds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "published_worlds_slug_key" ON "published_worlds"("slug");
-- The directory's own ordering: most-forked first among listed worlds.
CREATE INDEX "published_worlds_isListed_forkCount_idx" ON "published_worlds"("isListed", "forkCount");
CREATE INDEX "published_worlds_publishedBy_idx" ON "published_worlds"("publishedBy");
-- "Is this campaign already published?" for the publish button's state.
CREATE INDEX "published_worlds_sourceCampaignId_idx" ON "published_worlds"("sourceCampaignId");

ALTER TABLE "published_worlds"
  ADD CONSTRAINT "published_worlds_publishedBy_fkey"
  FOREIGN KEY ("publishedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "published_worlds"
  ADD CONSTRAINT "published_worlds_sourceCampaignId_fkey"
  FOREIGN KEY ("sourceCampaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
