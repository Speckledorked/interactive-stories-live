-- #286: an early pre-baseline migration created an ivfflat ANN index on
-- campaign_memories.embedding plus GIN indexes on the entity-id arrays,
-- but none of this survived into 0_baseline/migration.sql — every
-- similarity search retrieveRelevantHistory runs (ORDER BY embedding <=>
-- $1) has been an exact, unindexed sequential scan + sort over every
-- embedded memory row in the campaign, not the approximate-NN lookup the
-- surrounding code comments describe.
--
-- HNSW instead of the original ivfflat (pgvector 0.6.0 supports both):
-- ivfflat's index quality depends on being trained on representative data
-- at CREATE INDEX time, so an index built while a campaign's memory table
-- is small or empty (the common case for a table that starts empty and
-- grows over the campaign's lifetime) has poor recall until manually
-- rebuilt later. HNSW has no such cold-start requirement.
CREATE INDEX "campaign_memories_embedding_idx" ON "campaign_memories" USING hnsw (embedding vector_cosine_ops);

-- Entity-id array filtering, restored with correct quoting this time: the
-- pre-baseline version referenced these columns unquoted
-- (involvedCharacterIds etc.), which Postgres folds to lowercase
-- identifiers that never matched the real quoted camelCase columns —
-- those three CREATE INDEX statements would have failed outright had
-- they ever actually been run against this schema.
CREATE INDEX "campaign_memories_characters_idx" ON "campaign_memories" USING GIN ("involvedCharacterIds");
CREATE INDEX "campaign_memories_npcs_idx" ON "campaign_memories" USING GIN ("involvedNpcIds");
CREATE INDEX "campaign_memories_factions_idx" ON "campaign_memories" USING GIN ("involvedFactionIds");
