-- #493: campaign creation becomes a job with stages.
--
-- Creation made five model calls and seeded a dozen tables inside the POST.
-- The request routinely ran past a minute, the modal said "Building your
-- world..." the whole time with no idea how far along it was, and a closed
-- tab lost the lot with nothing to resume.
--
-- Mirrors ResolutionJob, which already does this for scene resolution,
-- plus a stage: resolution is one opaque step, creation is five
-- distinguishable ones, and which one is running is exactly what the modal
-- could not say.
CREATE TYPE "CampaignCreationStage" AS ENUM ('QUEUED', 'WORLD', 'DETAILS', 'SEEDING', 'DONE');

CREATE TABLE "campaign_creation_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ResolutionJobStatus" NOT NULL DEFAULT 'PENDING',
    "stage" "CampaignCreationStage" NOT NULL DEFAULT 'QUEUED',
    -- The validated creation request, so the worker runs without the
    -- original HTTP context. No secrets: title, description, universe,
    -- template and an optional lore URL, all supplied by the one user who
    -- is also the only reader of this row.
    "input" JSONB NOT NULL,
    -- Set when the seeding transaction commits. The client navigates here.
    "campaignId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "campaign_creation_jobs_pkey" PRIMARY KEY ("id")
);

-- The poll is always "my newest job"...
CREATE INDEX "campaign_creation_jobs_userId_createdAt_idx" ON "campaign_creation_jobs"("userId", "createdAt");
-- ...and the stuck-job sweep is always "anything still running".
CREATE INDEX "campaign_creation_jobs_status_idx" ON "campaign_creation_jobs"("status");

ALTER TABLE "campaign_creation_jobs"
  ADD CONSTRAINT "campaign_creation_jobs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
