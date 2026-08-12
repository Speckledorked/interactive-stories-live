-- LoreCitation: per-scene record of which imported lore was actually
-- retrieved into that scene's prompt.
CREATE TABLE "lore_citations" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "loreEntryId" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lore_citations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lore_citations_campaignId_idx" ON "lore_citations"("campaignId");
CREATE INDEX "lore_citations_sceneId_idx" ON "lore_citations"("sceneId");
CREATE INDEX "lore_citations_loreEntryId_idx" ON "lore_citations"("loreEntryId");

-- StateMutation: audit trail for every proposed AI state change, including
-- rejections, that reaches business-rule validation (entity resolution,
-- clamping, etc.) — distinct from ai_validation_failures, which covers
-- whole-response Zod schema failures.
CREATE TYPE "StateMutationResult" AS ENUM ('ACCEPTED', 'REJECTED', 'REPAIRED');
CREATE TYPE "StateMutationProposer" AS ENUM ('AI_GM');

CREATE TABLE "state_mutations" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sceneId" TEXT,
    "proposedBy" "StateMutationProposer" NOT NULL DEFAULT 'AI_GM',
    "field" TEXT NOT NULL,
    "previousValue" JSONB,
    "proposedValue" JSONB,
    "result" "StateMutationResult" NOT NULL,
    "repairedValue" JSONB,
    "reason" TEXT,
    "appliedEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "state_mutations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "state_mutations_campaignId_idx" ON "state_mutations"("campaignId");
CREATE INDEX "state_mutations_sceneId_idx" ON "state_mutations"("sceneId");
CREATE INDEX "state_mutations_campaignId_result_idx" ON "state_mutations"("campaignId", "result");

-- LoreEntry.contentHash: idempotency key for re-runs of the same import
-- job. Backfill existing rows with an md5 of their content (32 hex chars)
-- — deliberately a different hash space than the real sha256 (64 hex
-- chars) the application writes going forward, so a backfilled value can
-- never collide with a real one even in principle.
ALTER TABLE "lore_entries" ADD COLUMN "contentHash" TEXT;
UPDATE "lore_entries" SET "contentHash" = md5("content") WHERE "contentHash" IS NULL;
ALTER TABLE "lore_entries" ALTER COLUMN "contentHash" SET NOT NULL;
CREATE UNIQUE INDEX "lore_entries_jobId_contentHash_key" ON "lore_entries"("jobId", "contentHash");
