-- Session revocation (#98).
-- Additive and defaulted: existing rows get 0 and no session is disturbed.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
