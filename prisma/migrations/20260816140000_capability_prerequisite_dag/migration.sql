-- #372: capability prerequisites become a DAG.
--
-- `CampaignCapability.parentId` was a single nullable parent, so the
-- structure was a TREE: every node had at most one prerequisite. That
-- cannot express "Battle Alchemy requires Alchemy AND Swordplay", and
-- convergent branches — where a deeper art draws on two disciplines — are
-- usually the most interesting nodes in a skill tree.
--
-- Acyclicity is preserved by the same invariant as before, not by a new
-- check: resolvePrerequisiteLinks only links a prerequisite of STRICTLY
-- LOWER tier, so every edge decreases tier and no path can return to its
-- start. That holds for many prerequisites exactly as it did for one.

CREATE TABLE "CapabilityPrerequisite" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "prerequisiteCapabilityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapabilityPrerequisite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CapabilityPrerequisite_capabilityId_prerequisiteCapabilityId_key"
    ON "CapabilityPrerequisite"("capabilityId", "prerequisiteCapabilityId");
CREATE INDEX "CapabilityPrerequisite_capabilityId_idx"
    ON "CapabilityPrerequisite"("capabilityId");
CREATE INDEX "CapabilityPrerequisite_prerequisiteCapabilityId_idx"
    ON "CapabilityPrerequisite"("prerequisiteCapabilityId");

-- Cascade on BOTH sides. This differs from parentId's ON DELETE SET NULL
-- and means the same thing: deleting a prerequisite drops the EDGE,
-- orphaning the deeper art into a root rather than deleting it too. With a
-- column, "orphan the child" meant nulling the field; with an edge table it
-- means removing the row.
ALTER TABLE "CapabilityPrerequisite"
    ADD CONSTRAINT "CapabilityPrerequisite_capabilityId_fkey"
    FOREIGN KEY ("capabilityId") REFERENCES "CampaignCapability"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CapabilityPrerequisite"
    ADD CONSTRAINT "CapabilityPrerequisite_prerequisiteCapabilityId_fkey"
    FOREIGN KEY ("prerequisiteCapabilityId") REFERENCES "CampaignCapability"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- BACKFILL, before the column is dropped. Every existing tree edge becomes
-- a DAG edge, so a live campaign's prerequisites survive the conversion
-- exactly as authored. A self-referential parentId (which the old schema
-- did not forbid) is excluded rather than migrated — it would be a
-- one-node cycle, permanently un-unlockable.
INSERT INTO "CapabilityPrerequisite" ("id", "capabilityId", "prerequisiteCapabilityId", "createdAt")
SELECT
    gen_random_uuid()::text,
    "id",
    "parentId",
    CURRENT_TIMESTAMP
FROM "CampaignCapability"
WHERE "parentId" IS NOT NULL
  AND "parentId" <> "id";

-- Only now is the column redundant. Kept nowhere: it would be a pure
-- subset of the table above, and a second copy of the same fact is the
-- thing #425 exists to warn about.
DROP INDEX IF EXISTS "CampaignCapability_parentId_idx";
ALTER TABLE "CampaignCapability" DROP CONSTRAINT IF EXISTS "CampaignCapability_parentId_fkey";
ALTER TABLE "CampaignCapability" DROP COLUMN "parentId";
