-- Battle-map generation is now opt-in per campaign (README Known Bugs #9/#59).
-- Defaults false, including for existing campaigns: every qualifying scene
-- resolution otherwise makes a second AI call and writes a fresh batch of
-- zones/tokens, which is real recurring cost for a feature many campaigns
-- never look at. A campaign that wants maps enables them once from the
-- admin panel.
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "mapGenerationEnabled" BOOLEAN NOT NULL DEFAULT false;
