-- Phase 4: universe-scoped semantic invariants. Null is always safe —
-- every semantic check degrades to its unconditional Phase 1/1b behavior
-- when a campaign has no worldRules yet.

ALTER TABLE "Campaign" ADD COLUMN "worldRules" JSONB;
