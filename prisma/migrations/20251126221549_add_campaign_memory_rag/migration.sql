-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('SCENE', 'NPC_INTERACTION', 'FACTION_EVENT', 'LOCATION_EVENT', 'CHARACTER_MOMENT', 'CLOCK_COMPLETION', 'WORLD_EVENT');

-- CreateEnum
CREATE TYPE "MemoryImportance" AS ENUM ('MINOR', 'NORMAL', 'MAJOR', 'CRITICAL');

-- CreateTable
CREATE TABLE "campaign_memories" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "memoryType" "MemoryType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "turnNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "fullContext" TEXT NOT NULL,
    "embedding" vector(1536),
    "involvedCharacterIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "involvedNpcIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "involvedFactionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locationTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "importance" "MemoryImportance" NOT NULL DEFAULT 'NORMAL',
    "emotionalTone" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_memories_campaignId_turnNumber_idx" ON "campaign_memories"("campaignId", "turnNumber");

-- CreateIndex
CREATE INDEX "campaign_memories_campaignId_memoryType_idx" ON "campaign_memories"("campaignId", "memoryType");

-- CreateIndex
CREATE INDEX "campaign_memories_campaignId_importance_idx" ON "campaign_memories"("campaignId", "importance");

-- CreateIndex (pgvector-specific for semantic search)
-- Using ivfflat index for fast approximate nearest neighbor search
CREATE INDEX campaign_memories_embedding_idx ON campaign_memories
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- CreateIndex (GIN indexes for array searches - entity filtering)
CREATE INDEX campaign_memories_characters_idx ON campaign_memories USING GIN (involvedCharacterIds);
CREATE INDEX campaign_memories_npcs_idx ON campaign_memories USING GIN (involvedNpcIds);
CREATE INDEX campaign_memories_factions_idx ON campaign_memories USING GIN (involvedFactionIds);

-- AddForeignKey
ALTER TABLE "campaign_memories" ADD CONSTRAINT "campaign_memories_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
