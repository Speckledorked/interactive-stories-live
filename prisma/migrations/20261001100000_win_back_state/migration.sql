-- #506: win-back state.
--
-- Per MEMBERSHIP, not per user: a player lapsed on one world and playing
-- another every night is not a lapsed player, and a per-user counter would
-- either mail them about the world they left or stay silent about it
-- because of the one they didn't. What lapses is a seat at a table.
--
-- Both columns default to "never sent", so every existing membership
-- starts eligible — which is correct, since no win-back has ever been sent.
ALTER TABLE "CampaignMembership" ADD COLUMN "winBackSentAt" TIMESTAMP(3);
ALTER TABLE "CampaignMembership" ADD COLUMN "winBackCount" INTEGER NOT NULL DEFAULT 0;

-- Opt-out, matching every other email preference on this table. Default
-- true so an existing user's silence is not read as a refusal they never
-- gave; the unsubscribe path is the settings page, same as the rest.
ALTER TABLE "user_notification_settings" ADD COLUMN "emailWinBack" BOOLEAN NOT NULL DEFAULT true;
