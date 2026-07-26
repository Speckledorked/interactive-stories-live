-- Add missing Character fields that were added in schema but not in database
-- This migration adds statUsage which was causing P2022 errors

-- Add statUsage column to Character table
ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "statUsage" JSONB;
