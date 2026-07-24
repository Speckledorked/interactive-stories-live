-- Browser-push and sound notification preferences backed two delivery
-- pipelines that were each wired at only one end and could never reach a
-- user: push published a Pusher event with no client listener, sound
-- published to a service whose audio files don't exist, and the service
-- worker's push listener had no subscription flow to ever fire it
-- (README #10/#63/#64). Removed along with the pipelines rather than kept
-- as settings for features that don't exist. Email and in-app remain.
ALTER TABLE "user_notification_settings"
  DROP COLUMN IF EXISTS "pushEnabled",
  DROP COLUMN IF EXISTS "pushTurnReminders",
  DROP COLUMN IF EXISTS "pushSceneChanges",
  DROP COLUMN IF EXISTS "pushMentions",
  DROP COLUMN IF EXISTS "pushWhispers",
  DROP COLUMN IF EXISTS "pushCampaignInvites",
  DROP COLUMN IF EXISTS "soundEnabled",
  DROP COLUMN IF EXISTS "soundTurnReminders",
  DROP COLUMN IF EXISTS "soundSceneChanges",
  DROP COLUMN IF EXISTS "soundMentions",
  DROP COLUMN IF EXISTS "soundWhispers",
  DROP COLUMN IF EXISTS "soundCriticalMoments",
  DROP COLUMN IF EXISTS "soundWorldEvents";
