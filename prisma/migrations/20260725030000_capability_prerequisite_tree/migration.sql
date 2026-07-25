-- Capability prerequisite tree (README #82).
--
-- parentId previously existed here as an unread, unwritten column and was
-- dropped in 20260724230000_drop_capability_parent for implying a feature
-- that didn't exist. It comes back with the feature: world generation
-- declares each deeper art's prerequisite, and unlocking a node requires
-- its parent to already be UNLOCKED (see lib/game/capabilities.ts,
-- prerequisiteUnlockBlocked).
--
-- SET NULL, not CASCADE: removing a prerequisite must orphan its children
-- into roots, never delete the deeper arts hanging off it.
ALTER TABLE "CampaignCapability" ADD COLUMN IF NOT EXISTS "parentId" TEXT;

CREATE INDEX IF NOT EXISTS "CampaignCapability_parentId_idx" ON "CampaignCapability"("parentId");

ALTER TABLE "CampaignCapability"
  ADD CONSTRAINT "CampaignCapability_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "CampaignCapability"("id") ON DELETE SET NULL ON UPDATE CASCADE;
