-- Per-universe progression: the rank ladder and any bounded slot groups.
--
-- A player learned in the fiction that essences exist and that ranks run
-- unranked -> iron -> bronze, and the sheet could say nothing about either.
-- Known facts updated, because they are free text; there was no "0/4
-- essences" and no position on a ladder, because no structure existed to
-- render one from.
--
-- Campaign.advancementTrack follows the generated-once-then-frozen pattern
-- already used by statLabels, corruptionTheme, calendarConfig and worldRules:
-- written at creation from the universe's own fiction, and NULL is a correct
-- answer meaning "this world has no such concept", which disables the display
-- entirely rather than inventing a ladder for a world without one.
--
-- Character.advancementTier is which rung the character stands on. Nullable
-- with no backfill ON PURPOSE, the same reasoning as User.orientationSeenAt:
-- null reads as the FIRST rung, so every existing character correctly appears
-- at the bottom of a ladder that did not exist when they were made, rather
-- than being stamped with a tier nobody earned.
--
-- Slot fill is not stored. It is counted from CampaignCapability rows whose
-- domain matches the group, so what a character has learned has exactly one
-- record. A second counter would be a second copy of the same fact.

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "advancementTrack" JSONB;
ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "advancementTier" TEXT;
