-- #508: the activation funnel had no stage between "asked for a world" and
-- "made a character".
--
-- CAMPAIGN_CREATED fires at the point of INTENT (see api/campaigns/route.ts
-- — deliberate, so a creation that dies in the worker shows as a drop-off).
-- That means a campaign whose generation failed looked identical in the
-- funnel to one that succeeded: both recorded the ask, neither recorded an
-- arrival. So "they never made a character" could mean the player gave up
-- or that the world never came, and nothing distinguished them.
--
-- WORLD_READY is the arrival. WORLD_FAILED is the permanent failure (not a
-- retry — the queue retries before it gives up), and is NOT a funnel stage:
-- a user can fail once and succeed later, so it is counted separately as a
-- leak rather than as a step everyone passes through.
ALTER TYPE "AnalyticsEventType" ADD VALUE 'WORLD_READY';
ALTER TYPE "AnalyticsEventType" ADD VALUE 'WORLD_FAILED';
