-- PostgreSQL initialization script for interactive-stories-live
-- This script runs automatically when the Docker container starts

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify the extension is enabled
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
    ) THEN
        RAISE NOTICE 'pgvector extension is enabled';
    ELSE
        RAISE EXCEPTION 'Failed to enable pgvector extension';
    END IF;
END $$;
