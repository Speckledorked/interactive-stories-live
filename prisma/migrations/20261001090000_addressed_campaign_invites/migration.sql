-- #507: addressed campaign invites — the bridge from the friends system
-- into play.
--
-- A CampaignInvite was a bearer token and nothing else: whoever held the
-- link could redeem it, so inviting a specific person meant generating a
-- link and finding some channel outside MythOS to send it over. The
-- friends system knew who your friends were and could do nothing with
-- that. invitedUserId addresses an invite to one user; join/[token]
-- refuses it from anyone else.
--
-- Nullable, so every existing row keeps its current meaning exactly: NULL
-- is the link invite that already existed, and no backfill is needed or
-- wanted. ON DELETE CASCADE matches createdBy — a deleted account should
-- not leave invites addressed to it lying around redeemable by nobody.
ALTER TABLE "CampaignInvite" ADD COLUMN "invitedUserId" TEXT;

ALTER TABLE "CampaignInvite"
  ADD CONSTRAINT "CampaignInvite_invitedUserId_fkey"
  FOREIGN KEY ("invitedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Answers "has this friend already been invited to this campaign?" for the
-- invite picker, which otherwise scans every invite the campaign ever had.
CREATE INDEX "CampaignInvite_invitedUserId_campaignId_idx"
  ON "CampaignInvite"("invitedUserId", "campaignId");
