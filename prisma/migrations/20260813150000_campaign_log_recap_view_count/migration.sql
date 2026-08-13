-- #264 (adversarial audit): smallest real signal of whether shareable
-- session recaps are used at all — incremented once per successful load
-- of the public recap page, not when a share link is merely generated.
ALTER TABLE "campaign_logs" ADD COLUMN "recapViewCount" INTEGER NOT NULL DEFAULT 0;
