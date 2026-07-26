-- CampaignCapability.parentId implied a prerequisite tree that no
-- application code ever read or wrote (confirmed: zero references across
-- src/). Removed rather than left to imply a feature that doesn't exist —
-- same call as the dead TurnOrder model (README #34). Gating that IS real
-- (tier, isSecret, isShadow + corruption) is unaffected.
ALTER TABLE "CampaignCapability" DROP CONSTRAINT IF EXISTS "CampaignCapability_parentId_fkey";
ALTER TABLE "CampaignCapability" DROP COLUMN IF EXISTS "parentId";
