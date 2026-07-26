-- Real browser push (README #92), replacing the scaffolding removed in
-- #10/#63/#64 that could never fire. This adds the piece that was actually
-- missing: somewhere to store the browser's PushSubscription so the server
-- has an endpoint to send to.
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX IF NOT EXISTS "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

ALTER TABLE "push_subscriptions"
  ADD CONSTRAINT "push_subscriptions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restore the push/sound preference columns. They were dropped alongside
-- the dead pipelines; both channels are real now, so the settings are too.
ALTER TABLE "user_notification_settings"
  ADD COLUMN IF NOT EXISTS "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "pushTurnReminders" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "pushSceneChanges" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "pushMentions" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "pushWhispers" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "pushCampaignInvites" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "soundTurnReminders" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "soundSceneChanges" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "soundMentions" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "soundWhispers" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "soundCriticalMoments" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "soundWorldEvents" BOOLEAN NOT NULL DEFAULT true;
